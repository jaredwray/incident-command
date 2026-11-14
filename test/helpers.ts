import { type Config, loadConfig } from "@/lib/config";
import type { Actor, Settings, Subscriber } from "@/lib/domain/types";
import type {
	DeliveryChannel,
	DeliveryChannels,
} from "@/lib/notifications/delivery";
import type { Notifier, NotifyResult } from "@/lib/notifications/notifier";
import type { IncidentNotification } from "@/lib/notifications/templates";
import { createServices, type Services } from "@/lib/services";
import type { ServiceContext } from "@/lib/services/context";
import { MemoryStore } from "@/lib/store/memory";
import type { DocumentStore } from "@/lib/store/types";

/**
 * Environment that gives the email channel a provider and a sender, so the
 * public subscribe flow works in tests unless a test turns email off.
 */
export const EMAIL_ENV = {
	EMAIL_FROM: "status@test.dev",
	SENDGRID_API_KEY: "SG.test",
};

export class FakeNotifier implements Notifier {
	incidents: {
		notification: IncidentNotification;
		subscribers: Subscriber[];
		channels: DeliveryChannels;
	}[] = [];
	confirmations: { subscriber: Subscriber; channel: DeliveryChannel }[] = [];
	confirmationResult = true;
	fail = false;

	async notifyIncident(
		notification: IncidentNotification,
		subscribers: Subscriber[],
		channels: DeliveryChannels,
	): Promise<NotifyResult> {
		if (this.fail) {
			throw new Error("notifier exploded");
		}
		this.incidents.push({ notification, subscribers, channels });
		return { sent: subscribers.length, failed: 0 };
	}

	async sendConfirmation(
		subscriber: Subscriber,
		_settings: Settings,
		channel: DeliveryChannel,
	) {
		this.confirmations.push({ subscriber, channel });
		return this.confirmationResult;
	}
}

export class Clock {
	current: Date;
	constructor(iso = "2026-11-02T12:00:00.000Z") {
		this.current = new Date(iso);
	}
	now = () => new Date(this.current);
	set(iso: string) {
		this.current = new Date(iso);
	}
	advance(ms: number) {
		this.current = new Date(this.current.getTime() + ms);
	}
}

export const ADMIN: Actor = {
	type: "member",
	id: "mem_admin",
	name: "Ada Admin",
	role: "admin",
};
export const EDITOR: Actor = {
	type: "member",
	id: "mem_editor",
	name: "Ed Editor",
	role: "editor",
};
export const VIEWER: Actor = {
	type: "agent",
	id: "agt_viewer",
	name: "Vi Viewer",
	role: "viewer",
};

export interface TestContext extends ServiceContext {
	services: Services;
	clock: Clock;
	notifier: FakeNotifier;
	store: DocumentStore;
}

export function createTestContext(
	options: {
		config?: Partial<Config>;
		env?: Record<string, string>;
		store?: DocumentStore;
	} = {},
): TestContext {
	const clock = new Clock();
	const notifier = new FakeNotifier();
	const store = options.store ?? new MemoryStore();
	const config = {
		...loadConfig({ ...EMAIL_ENV, ...options.env }),
		...options.config,
	};
	const ctx: ServiceContext = { store, notifier, config, now: clock.now };
	return { ...ctx, services: createServices(ctx), clock, notifier, store };
}
