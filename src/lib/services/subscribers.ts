import { createId, createSecret } from "../crypto";
import {
	emailSubscriberSchema,
	subscribeSchema,
	webhookSubscriberSchema,
} from "../domain/schemas";
import type { Actor, Subscriber, SubscriberType } from "../domain/types";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { iso, parse, requireRole, type ServiceContext } from "./context";
import type { SettingsService } from "./settings";

export type SubscribeOutcome = "confirmation_sent" | "already_subscribed";

export class SubscriberService {
	private readonly ctx: ServiceContext;
	private readonly settings: SettingsService;

	constructor(ctx: ServiceContext, settings: SettingsService) {
		this.ctx = ctx;
		this.settings = settings;
	}

	/** Whether the public status page can offer email subscriptions. */
	async canSubscribe(): Promise<boolean> {
		const settings = await this.settings.get();
		return settings.allowSubscriptions && this.ctx.notifier.emailEnabled;
	}

	/** Public double opt-in email subscription. */
	async subscribe(input: { email: string }): Promise<SubscribeOutcome> {
		if (!(await this.canSubscribe())) {
			throw new ForbiddenError("Subscriptions are not enabled");
		}
		const { email } = parse(subscribeSchema, input);
		const existing = await this.findByTarget(email);
		if (existing?.confirmed) {
			return "already_subscribed";
		}
		const subscriber = existing ?? (await this.insert("email", email, false));
		const sent = await this.ctx.notifier.sendConfirmation(
			subscriber,
			await this.settings.get(),
		);
		if (!sent) {
			throw new AppError(
				"unavailable",
				"We couldn't send the confirmation email. Please try again later.",
			);
		}
		return "confirmation_sent";
	}

	async confirm(token: string): Promise<Subscriber | undefined> {
		const subscriber = await this.findByToken(token);
		if (!subscriber) {
			return undefined;
		}
		if (subscriber.confirmed) {
			return subscriber;
		}
		const next: Subscriber = {
			...subscriber,
			confirmed: true,
			confirmedAt: iso(this.ctx.now()),
		};
		await this.ctx.store.update("subscribers", next);
		return next;
	}

	async unsubscribe(token: string): Promise<boolean> {
		const subscriber = await this.findByToken(token);
		return subscriber
			? this.ctx.store.delete("subscribers", subscriber.id)
			: false;
	}

	async list(actor: Actor): Promise<Subscriber[]> {
		requireRole(actor, "admin");
		return this.ctx.store.find("subscribers", {
			sort: [{ field: "createdAt", direction: "desc" }],
		});
	}

	/** Every subscriber that should receive notifications. */
	async recipients(): Promise<Subscriber[]> {
		return this.ctx.store.find("subscribers", {
			where: [{ field: "confirmed", op: "eq", value: true }],
		});
	}

	async addWebhook(actor: Actor, input: { url: string }): Promise<Subscriber> {
		requireRole(actor, "admin");
		const { url } = parse(webhookSubscriberSchema, input);
		return this.insert("webhook", url, true);
	}

	/** Adds a pre-confirmed email subscriber (admins only, no opt-in email). */
	async addEmail(actor: Actor, input: { email: string }): Promise<Subscriber> {
		requireRole(actor, "admin");
		const { email } = parse(emailSubscriberSchema, input);
		return this.insert("email", email, true);
	}

	async remove(actor: Actor, id: string): Promise<void> {
		requireRole(actor, "admin");
		if (!(await this.ctx.store.delete("subscribers", id))) {
			throw new NotFoundError("Subscriber", id);
		}
	}

	private async insert(
		type: SubscriberType,
		target: string,
		confirmed: boolean,
	): Promise<Subscriber> {
		const now = iso(this.ctx.now());
		return this.ctx.store.insert("subscribers", {
			id: createId("sub"),
			type,
			target,
			confirmed,
			token: createSecret(24),
			createdAt: now,
			...(confirmed ? { confirmedAt: now } : {}),
		});
	}

	private async findByTarget(target: string) {
		const [subscriber] = await this.ctx.store.find("subscribers", {
			where: [{ field: "target", op: "eq", value: target }],
			limit: 1,
		});
		return subscriber;
	}

	private async findByToken(token: string) {
		if (!token) {
			return undefined;
		}
		const [subscriber] = await this.ctx.store.find("subscribers", {
			where: [{ field: "token", op: "eq", value: token }],
			limit: 1,
		});
		return subscriber;
	}
}
