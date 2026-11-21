import type { UpdateNotificationQueueInput } from "../domain/schemas";
import { updateNotificationQueueSchema } from "../domain/schemas";
import type {
	Actor,
	NotificationQueueSettings,
	PublicNotificationQueue,
	QueueProviderId,
} from "../domain/types";
import { ConflictError, ValidationError } from "../errors";
import { NotificationQueue } from "../notifications/queue";
import { QUEUE_PROVIDERS } from "../notifications/queue-catalog";
import { SecretBox } from "../secrets";
import { iso, parse, requirePermission, type ServiceContext } from "./context";
import type { NotificationJobService } from "./notification-jobs";

export const NOTIFICATION_QUEUE_CHANGED =
	"Somebody else changed the queue settings. Reload the page.";

export const QUEUE_URI_INVALID =
	"The connection URI is not correct for this provider.";

const QUEUE_ID = "queue";

function uriContext(provider: QueueProviderId): string {
	return `notification-queue/${provider}/uri`;
}

function matches(pattern: string, value: string): boolean {
	return new RegExp(`^(?:${pattern})$`).test(value);
}

/**
 * The selected qified provider. One document holds the choice. The URI
 * stays encrypted.
 */
export class NotificationQueueService {
	private readonly ctx: ServiceContext;
	private readonly box: SecretBox;
	private readonly queue: NotificationQueue;

	constructor(ctx: ServiceContext, queue = new NotificationQueue()) {
		this.ctx = ctx;
		this.box = new SecretBox(ctx.config.encryption);
		this.queue = queue;
	}

	/** Connects the consumer to the job runner. */
	attach(jobs: NotificationJobService): void {
		this.queue.setRunner((jobId, keepAlive) => jobs.process(jobId, keepAlive));
	}

	/** Starts the consumer when a provider is saved. It does not wait for the broker. */
	async bootstrap(): Promise<void> {
		const current = await this.stored();
		if (!current.provider) {
			return;
		}
		void this.connect(current).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[notifications] ${message}`);
		});
	}

	/** The choice without the URI. */
	async view(actor: Actor): Promise<PublicNotificationQueue> {
		requirePermission(actor, "channels.read");
		return this.public(await this.stored());
	}

	/**
	 * Saves one provider, or clears the queue. An empty URI keeps the saved
	 * URI when the provider stays the same.
	 */
	async update(
		actor: Actor,
		input: UpdateNotificationQueueInput,
	): Promise<{ settings: PublicNotificationQueue; ready: boolean }> {
		requirePermission(actor, "channels.providers");
		const data = parse(updateNotificationQueueSchema, input);
		const stored = await this.ctx.store.get("notification_queue", QUEUE_ID, {
			consistent: true,
		});
		const current = stored ?? this.defaults();
		if (data.revision !== current.revision) {
			throw new ConflictError(NOTIFICATION_QUEUE_CHANGED);
		}
		const next = this.next(current, data.provider, data.uri);
		const saved = stored
			? await this.ctx.store.update("notification_queue", next, {
					where: [{ field: "revision", op: "eq", value: current.revision }],
				})
			: await this.ctx.store.insert("notification_queue", next);
		if (!saved) {
			throw new ConflictError(NOTIFICATION_QUEUE_CHANGED);
		}
		const ready = await this.connect(saved);
		return { settings: this.public(saved), ready };
	}

	/** The selected provider, or none. Pages use this. */
	async provider(): Promise<QueueProviderId | undefined> {
		return (await this.stored()).provider;
	}

	/** Opens the queue and enqueues one job. */
	async enqueue(jobId: string): Promise<"ok" | "load" | "enqueue"> {
		const current = await this.stored();
		if (!current.provider) {
			return "enqueue";
		}
		const ready = await this.connect(current);
		if (!ready) {
			return "load";
		}
		return this.queue.enqueue(jobId);
	}

	private defaults(): NotificationQueueSettings {
		return {
			id: QUEUE_ID,
			revision: 0,
			updatedAt: new Date(0).toISOString(),
		};
	}

	private async stored(): Promise<NotificationQueueSettings> {
		return (
			(await this.ctx.store.get("notification_queue", QUEUE_ID, {
				consistent: true,
			})) ?? this.defaults()
		);
	}

	private public(settings: NotificationQueueSettings): PublicNotificationQueue {
		return {
			...(settings.provider ? { provider: settings.provider } : {}),
			hasUri: settings.uri !== undefined,
			revision: settings.revision,
		};
	}

	private next(
		current: NotificationQueueSettings,
		provider: QueueProviderId | undefined,
		uriText: string | undefined,
	): NotificationQueueSettings {
		const now = iso(this.ctx.now());
		if (!provider) {
			return { id: QUEUE_ID, revision: current.revision + 1, updatedAt: now };
		}
		const definition = QUEUE_PROVIDERS[provider];
		const typed = uriText?.trim() ?? "";
		let uri = current.provider === provider ? current.uri : undefined;
		if (typed !== "") {
			if (!matches(definition.uri.pattern, typed)) {
				throw new ValidationError(QUEUE_URI_INVALID);
			}
			uri = this.box.encrypt(typed, uriContext(provider));
		} else if (uri) {
			uri = this.box.rotate(uri, uriContext(provider));
		}
		const next: NotificationQueueSettings = {
			id: QUEUE_ID,
			provider,
			revision: current.revision + 1,
			updatedAt: now,
		};
		if (uri) {
			next.uri = uri;
		}
		return next;
	}

	/** Opens the consumer. False when the package or the broker does not open. */
	private async connect(settings: NotificationQueueSettings): Promise<boolean> {
		if (!settings.provider) {
			await this.queue.close();
			return true;
		}
		let uri: string | undefined;
		if (settings.uri) {
			try {
				uri = this.box.decrypt(settings.uri, uriContext(settings.provider));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[notifications] ${message}`);
				return false;
			}
		}
		const result = await this.queue.open(
			settings.provider,
			uri,
			settings.revision,
		);
		return result === "ok";
	}
}
