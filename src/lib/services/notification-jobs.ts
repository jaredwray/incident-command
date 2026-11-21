import { createId } from "../crypto";
import { can } from "../domain/permissions";
import type {
	Actor,
	DeliveryFailure,
	DeliveryState,
	NotificationDelivery,
	NotificationJob,
	NotificationJobView,
	NotificationProgress,
	QueueFallback,
	Service,
	Subscriber,
} from "../domain/types";
import { NotFoundError } from "../errors";
import { canDeliver, type DeliveryChannels } from "../notifications/delivery";
import { maskTarget } from "../notifications/mask";
import type { IncidentNotification } from "../notifications/templates";
import type { ServiceCatalog } from "./catalog";
import {
	authorRef,
	iso,
	requirePermission,
	type ServiceContext,
} from "./context";
import { incidentAsOf } from "./incidents";
import type { NotificationQueueService } from "./notification-queue";
import type { NotificationSettingsService } from "./notification-settings";
import type { SettingsService } from "./settings";

const BATCH = 20;
const DETAIL_LIMIT = 200;
const RECOVER_INTERVAL_MS = 10_000;
const DIRECT_STALE_MS = 2 * 60 * 1000;
const DURABLE_STALE_MS = 15 * 60 * 1000;
const RECENT_MS = 10 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface PreparedSend {
	notification: IncidentNotification;
	subscribers: Map<string, Subscriber>;
	channels: DeliveryChannels;
}

export interface StartSend {
	actor: Actor;
	notification: IncidentNotification;
	subscribers: Subscriber[];
	channels: DeliveryChannels;
	jobId?: string;
	delivery?: "wait" | "background";
}

/**
 * Records each notification and sends it. A queue provider sends in the
 * background. With no provider, this process sends.
 */
export class NotificationJobService {
	private readonly ctx: ServiceContext;
	private readonly settings: SettingsService;
	private readonly notificationSettings: NotificationSettingsService;
	private readonly catalog: ServiceCatalog;
	private readonly queue: NotificationQueueService;
	private readonly ready = new Map<string, PreparedSend>();
	private lastRecover = 0;
	private lastPrune = 0;
	private recoverTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		ctx: ServiceContext,
		settings: SettingsService,
		notificationSettings: NotificationSettingsService,
		catalog: ServiceCatalog,
		queue: NotificationQueueService,
	) {
		this.ctx = ctx;
		this.settings = settings;
		this.notificationSettings = notificationSettings;
		this.catalog = catalog;
		this.queue = queue;
	}

	/**
	 * Creates one job and sends it, or puts it on the queue.
	 * Returns nothing when no subscriber can receive the notice.
	 */
	async start(input: StartSend): Promise<NotificationJob | undefined> {
		const recipients = input.subscribers.filter(
			(subscriber) =>
				subscriber.confirmed && canDeliver(input.channels[subscriber.type]),
		);
		if (recipients.length === 0) {
			return undefined;
		}
		const provider = await this.queue.provider();
		const now = iso(this.ctx.now());
		const job: NotificationJob = {
			id: input.jobId ?? createId("njb"),
			incidentId: input.notification.incident.id,
			updateId: input.notification.update.id,
			event: input.notification.event,
			queued: provider !== undefined,
			state: "active",
			total: recipients.length,
			sent: 0,
			failed: 0,
			createdBy: authorRef(input.actor),
			createdAt: now,
			heartbeatAt: now,
		};
		if (provider) {
			job.provider = provider;
		}
		await this.ctx.store.insert("notification_jobs", job);
		for (const [order, subscriber] of recipients.entries()) {
			await this.ctx.store.insert("notification_deliveries", {
				id: createId("ndl"),
				jobId: job.id,
				subscriberId: subscriber.id,
				channel: subscriber.type,
				label: maskTarget(subscriber.type, subscriber.target),
				order,
				state: "pending",
				createdAt: now,
				updatedAt: now,
			});
		}
		this.ready.set(job.id, {
			notification: input.notification,
			subscribers: new Map(
				recipients.map((subscriber) => [subscriber.id, subscriber]),
			),
			channels: input.channels,
		});
		await this.prune();
		if (!provider) {
			if (input.delivery === "background") {
				void this.run(job.id);
				return job;
			}
			await this.run(job.id);
			return this.reload(job);
		}
		const queued = await this.queue.enqueue(job.id);
		if (queued === "ok") {
			this.ready.delete(job.id);
			return this.reload(job);
		}
		await this.markFallback(job.id, queued);
		void this.run(job.id);
		return this.reload(job);
	}

	/** Sends the open rows of one job. The queue consumer calls this. */
	async process(jobId: string, keepAlive?: () => Promise<void>): Promise<void> {
		const job = await this.ctx.store.get("notification_jobs", jobId, {
			consistent: true,
		});
		if (!job || job.state === "done") {
			return;
		}
		const prepared = await this.prepare(job);
		if (!prepared) {
			await this.failRows(jobId, ["pending", "sending"], "not_sent");
			await this.finish(jobId);
			return;
		}
		for (;;) {
			const pending = await this.ctx.store.find("notification_deliveries", {
				where: [
					{ field: "jobId", op: "eq", value: jobId },
					{ field: "state", op: "eq", value: "pending" },
				],
				sort: [{ field: "order", direction: "asc" }],
				limit: BATCH,
			});
			if (pending.length === 0) {
				break;
			}
			const claimed = await this.claim(pending);
			if (claimed.length === 0) {
				break;
			}
			const subscribers = claimed.flatMap((row) => {
				const subscriber = prepared.subscribers.get(row.subscriberId);
				return subscriber ? [subscriber] : [];
			});
			const reported = new Set<string>();
			await this.ctx.notifier.notifyIncident(
				prepared.notification,
				subscribers,
				prepared.channels,
				async (subscriber, ok) => {
					reported.add(subscriber.id);
					const row = claimed.find(
						(item) => item.subscriberId === subscriber.id,
					);
					if (!row) {
						return;
					}
					await this.writeState(
						row,
						ok ? "sent" : "failed",
						ok ? undefined : "provider",
					);
				},
			);
			for (const row of claimed) {
				if (!reported.has(row.subscriberId)) {
					await this.writeState(row, "failed", "not_sent");
				}
			}
			await this.touch(jobId);
			if (keepAlive) {
				try {
					await keepAlive();
				} catch {
					// The task keeps its original deadline.
				}
			}
		}
		await this.finish(jobId);
		this.ready.delete(jobId);
	}

	/** Runs a job and logs a failure. A direct send uses this. */
	async run(jobId: string): Promise<void> {
		try {
			await this.process(jobId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[notifications] failed to send ${jobId}: ${message}`);
		}
	}

	/**
	 * Sends jobs whose heartbeat is old. A lost task or a restart leaves
	 * the job active. This method claims it. The server start and each
	 * progress request call this method, thus it does not wait for the send.
	 */
	async recover(): Promise<void> {
		const now = this.ctx.now().getTime();
		if (now - this.lastRecover < RECOVER_INTERVAL_MS) {
			return;
		}
		this.lastRecover = now;
		const jobs = await this.ctx.store.find("notification_jobs", {
			where: [{ field: "state", op: "eq", value: "active" }],
		});
		const stale: string[] = [];
		let nextDue = Number.POSITIVE_INFINITY;
		for (const job of jobs) {
			const due = new Date(job.heartbeatAt).getTime() + staleAfter(job);
			if (due > now) {
				nextDue = Math.min(nextDue, due);
				continue;
			}
			const claimed = await this.ctx.store.update(
				"notification_jobs",
				{ ...job, heartbeatAt: iso(this.ctx.now()) },
				{
					where: [{ field: "heartbeatAt", op: "eq", value: job.heartbeatAt }],
				},
			);
			if (!claimed) {
				continue;
			}
			await this.failRows(job.id, ["sending"], "interrupted");
			if (job.queued) {
				await this.markFallback(job.id, "stalled");
			}
			stale.push(job.id);
		}
		this.planRecover(
			nextDue === Number.POSITIVE_INFINITY ? undefined : nextDue,
		);
		void this.runEach(stale);
	}

	/**
	 * Runs another pass when the next heartbeat becomes old. A restart can
	 * leave a fresh job, and no portal request is required to send it.
	 */
	private planRecover(dueAt: number | undefined): void {
		if (this.recoverTimer) {
			clearTimeout(this.recoverTimer);
			this.recoverTimer = undefined;
		}
		if (dueAt === undefined) {
			return;
		}
		const delay = Math.max(0, dueAt - this.ctx.now().getTime());
		const timer = setTimeout(() => {
			this.recoverTimer = undefined;
			void this.recover();
		}, delay);
		timer.unref?.();
		this.recoverTimer = timer;
	}

	/** One job, or nothing when the id is unknown. */
	async lookup(actor: Actor, id: string): Promise<NotificationJob | undefined> {
		requirePermission(actor, "notifications.send");
		return this.ctx.store.get("notification_jobs", id, { consistent: true });
	}

	/** One job and its rows. An editor does not see addresses. */
	async detail(actor: Actor, id: string): Promise<NotificationJobView> {
		requirePermission(actor, "notifications.send");
		await this.recover();
		await this.prune();
		const job = await this.ctx.store.get("notification_jobs", id, {
			consistent: true,
		});
		if (!job) {
			throw new NotFoundError("Notification job", id);
		}
		const rows = await this.ctx.store.find("notification_deliveries", {
			where: [{ field: "jobId", op: "eq", value: job.id }],
			sort: [{ field: "order", direction: "asc" }],
			limit: DETAIL_LIMIT + 1,
		});
		const truncated = rows.length > DETAIL_LIMIT;
		const shown = truncated ? rows.slice(0, DETAIL_LIMIT) : rows;
		const labels = can(actor, "subscribers.read");
		const counts = await this.counts(job);
		return {
			id: job.id,
			incidentId: job.incidentId,
			state: job.state,
			total: job.total,
			sent: counts.sent,
			failed: counts.failed,
			queued: job.queued,
			...(job.fallback ? { fallback: job.fallback } : {}),
			truncated,
			deliveries: shown.map((row) => ({
				id: row.id,
				channel: row.channel,
				order: row.order,
				state: row.state,
				...(labels ? { label: row.label } : {}),
				...(row.error ? { error: row.error } : {}),
			})),
		};
	}

	/**
	 * The queued sends for one incident. Active jobs count, and jobs that
	 * finished in the last 10 minutes count. Other jobs do not.
	 */
	async incidentProgress(
		actor: Actor,
		incidentId: string,
	): Promise<NotificationProgress | undefined> {
		requirePermission(actor, "notifications.send");
		await this.recover();
		await this.prune();
		const jobs = await this.ctx.store.find("notification_jobs", {
			where: [{ field: "incidentId", op: "eq", value: incidentId }],
		});
		const since = new Date(this.ctx.now().getTime() - RECENT_MS).toISOString();
		const relevant = jobs.filter(
			(job) =>
				job.queued &&
				(job.state === "active" ||
					(job.finishedAt !== undefined && job.finishedAt >= since)),
		);
		if (relevant.length === 0) {
			return undefined;
		}
		let total = 0;
		let sent = 0;
		let failed = 0;
		let active = 0;
		let fallback = false;
		for (const job of relevant) {
			total += job.total;
			if (job.fallback) {
				fallback = true;
			}
			if (job.state === "active") {
				active += 1;
			}
			const counts = await this.counts(job);
			sent += counts.sent;
			failed += counts.failed;
		}
		return { total, done: sent + failed, sent, failed, active, fallback };
	}

	/** Runs the jobs one after the other. It does not reject. */
	private async runEach(jobIds: readonly string[]): Promise<void> {
		for (const jobId of jobIds) {
			await this.run(jobId);
		}
	}

	private async reload(job: NotificationJob): Promise<NotificationJob> {
		return (
			(await this.ctx.store.get("notification_jobs", job.id, {
				consistent: true,
			})) ?? job
		);
	}

	private async prepare(
		job: NotificationJob,
	): Promise<PreparedSend | undefined> {
		const cached = this.ready.get(job.id);
		if (cached) {
			return cached;
		}
		const stored = await this.ctx.store.get("incidents", job.incidentId, {
			consistent: true,
		});
		if (!stored) {
			return undefined;
		}
		const snapshot = incidentAsOf(stored, job.updateId);
		if (!snapshot) {
			return undefined;
		}
		const rows = await this.ctx.store.find("notification_deliveries", {
			where: [{ field: "jobId", op: "eq", value: job.id }],
		});
		const subscribers = new Map<string, Subscriber>();
		for (const row of rows) {
			const subscriber = await this.ctx.store.get(
				"subscribers",
				row.subscriberId,
			);
			if (subscriber) {
				subscribers.set(subscriber.id, subscriber);
			}
		}
		const services = (await this.catalog.list()).filter((service: Service) =>
			snapshot.incident.serviceIds.includes(service.id),
		);
		return {
			notification: {
				event: job.event,
				incident: snapshot.incident,
				update: snapshot.update,
				settings: await this.settings.get(),
				services,
			},
			subscribers,
			channels: await this.notificationSettings.resolve(),
		};
	}

	private async claim(
		rows: readonly NotificationDelivery[],
	): Promise<NotificationDelivery[]> {
		const claimed: NotificationDelivery[] = [];
		const now = iso(this.ctx.now());
		for (const row of rows) {
			const saved = await this.ctx.store.update(
				"notification_deliveries",
				{ ...row, state: "sending", updatedAt: now },
				{ where: [{ field: "state", op: "eq", value: "pending" }] },
			);
			if (saved) {
				claimed.push(saved);
			}
		}
		return claimed;
	}

	private async writeState(
		row: NotificationDelivery,
		state: "sent" | "failed",
		error: DeliveryFailure | undefined,
	): Promise<void> {
		const next: NotificationDelivery = {
			...row,
			state,
			updatedAt: iso(this.ctx.now()),
		};
		if (error) {
			next.error = error;
		} else {
			delete next.error;
		}
		await this.ctx.store.update("notification_deliveries", next, {
			where: [{ field: "state", op: "eq", value: row.state }],
		});
	}

	private async failRows(
		jobId: string,
		states: readonly DeliveryState[],
		error: DeliveryFailure,
	): Promise<void> {
		const rows = await this.ctx.store.find("notification_deliveries", {
			where: [{ field: "jobId", op: "eq", value: jobId }],
		});
		const now = iso(this.ctx.now());
		for (const row of rows) {
			if (!states.includes(row.state)) {
				continue;
			}
			await this.ctx.store.update(
				"notification_deliveries",
				{ ...row, state: "failed", error, updatedAt: now },
				{ where: [{ field: "state", op: "eq", value: row.state }] },
			);
		}
	}

	private async finish(jobId: string): Promise<void> {
		const job = await this.ctx.store.get("notification_jobs", jobId, {
			consistent: true,
		});
		if (!job || job.state === "done") {
			return;
		}
		const counts = await this.counts(job);
		// Separate counts can disagree. A done job must account for every row.
		if (counts.open > 0 || counts.sent + counts.failed !== job.total) {
			return;
		}
		const now = iso(this.ctx.now());
		await this.ctx.store.update(
			"notification_jobs",
			{
				...job,
				state: "done",
				sent: counts.sent,
				failed: counts.failed,
				heartbeatAt: now,
				finishedAt: now,
			},
			{ where: [{ field: "state", op: "eq", value: "active" }] },
		);
	}

	private async counts(
		job: NotificationJob,
	): Promise<{ sent: number; failed: number; open: number }> {
		if (job.state === "done") {
			return { sent: job.sent, failed: job.failed, open: 0 };
		}
		const sent = await this.count(job.id, "sent");
		const failed = await this.count(job.id, "failed");
		const pending = await this.count(job.id, "pending");
		const sending = await this.count(job.id, "sending");
		return { sent, failed, open: pending + sending };
	}

	private count(jobId: string, state: DeliveryState): Promise<number> {
		return this.ctx.store.count("notification_deliveries", {
			where: [
				{ field: "jobId", op: "eq", value: jobId },
				{ field: "state", op: "eq", value: state },
			],
		});
	}

	private async touch(jobId: string): Promise<void> {
		const job = await this.ctx.store.get("notification_jobs", jobId, {
			consistent: true,
		});
		if (job?.state !== "active") {
			return;
		}
		await this.ctx.store.update(
			"notification_jobs",
			{ ...job, heartbeatAt: iso(this.ctx.now()) },
			{ where: [{ field: "state", op: "eq", value: "active" }] },
		);
	}

	private async markFallback(
		jobId: string,
		fallback: QueueFallback,
	): Promise<void> {
		const job = await this.ctx.store.get("notification_jobs", jobId, {
			consistent: true,
		});
		if (!job || job.state === "done") {
			return;
		}
		await this.ctx.store.update(
			"notification_jobs",
			{ ...job, fallback, heartbeatAt: iso(this.ctx.now()) },
			{ where: [{ field: "state", op: "eq", value: "active" }] },
		);
	}

	private async prune(): Promise<void> {
		const now = this.ctx.now().getTime();
		if (now - this.lastPrune < PRUNE_INTERVAL_MS) {
			return;
		}
		this.lastPrune = now;
		const cutoff = new Date(now - RETENTION_MS).toISOString();
		await this.ctx.store.deleteMany("notification_jobs", {
			where: [{ field: "createdAt", op: "lt", value: cutoff }],
		});
		await this.ctx.store.deleteMany("notification_deliveries", {
			where: [{ field: "createdAt", op: "lt", value: cutoff }],
		});
	}
}

function staleAfter(job: NotificationJob): number {
	if (!job.queued) {
		return DIRECT_STALE_MS;
	}
	return DURABLE_STALE_MS;
}
