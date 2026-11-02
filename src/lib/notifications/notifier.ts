import { Airhorn, type AirhornProvider, AirhornSendType } from "airhorn";
import type { Config, EmailConfig } from "../config";
import type { Settings, Subscriber } from "../domain/types";
import {
	CONFIRM_TEMPLATE,
	confirmUrl,
	EMAIL_TEMPLATE,
	emailData,
	type IncidentNotification,
	summaryText,
	WEBHOOK_TEMPLATE,
	webhookPayload,
} from "./templates";
import { WebhookProvider } from "./webhook";

export interface NotifyResult {
	sent: number;
	failed: number;
}

/** Sends subscriber notifications. Services depend on this interface only. */
export interface Notifier {
	readonly emailEnabled: boolean;
	notifyIncident(
		notification: IncidentNotification,
		subscribers: Subscriber[],
	): Promise<NotifyResult>;
	sendConfirmation(
		subscriber: Subscriber,
		settings: Settings,
	): Promise<boolean>;
}

export interface AirhornNotifierOptions {
	airhorn: Airhorn;
	email?: EmailConfig;
	siteUrl?: string;
	concurrency?: number;
	onError?: (error: Error) => void;
}

async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

/** Notifier backed by Airhorn: email via SendGrid/SES providers, webhooks built in. */
export class AirhornNotifier implements Notifier {
	readonly airhorn: Airhorn;
	private readonly email?: EmailConfig;
	private readonly siteUrl?: string;
	private readonly concurrency: number;
	private readonly onError: (error: Error) => void;

	constructor(options: AirhornNotifierOptions) {
		this.airhorn = options.airhorn;
		this.email = options.email;
		this.siteUrl = options.siteUrl;
		this.concurrency = options.concurrency ?? 10;
		this.onError =
			options.onError ??
			((error) => console.error(`[notifications] ${error.message}`));
	}

	get emailEnabled(): boolean {
		return this.email !== undefined;
	}

	async notifyIncident(
		notification: IncidentNotification,
		subscribers: Subscriber[],
	): Promise<NotifyResult> {
		const withSiteUrl = { ...notification, siteUrl: this.siteUrl };
		const recipients = subscribers.filter(
			(subscriber) =>
				subscriber.confirmed &&
				(subscriber.type === "webhook" || this.emailEnabled),
		);
		const payload = JSON.stringify(webhookPayload(withSiteUrl));
		const text = summaryText(withSiteUrl);
		const results = await mapLimit(
			recipients,
			this.concurrency,
			(subscriber) =>
				subscriber.type === "webhook"
					? this.deliver(
							subscriber.target,
							WEBHOOK_TEMPLATE,
							{ payload },
							AirhornSendType.Webhook,
						)
					: this.deliver(
							subscriber.target,
							EMAIL_TEMPLATE,
							emailData(withSiteUrl, subscriber),
							AirhornSendType.Email,
							{ from: this.email?.from, text },
						),
		);
		const sent = results.filter(Boolean).length;
		return { sent, failed: results.length - sent };
	}

	async sendConfirmation(
		subscriber: Subscriber,
		settings: Settings,
	): Promise<boolean> {
		if (!this.email || subscriber.type !== "email") {
			return false;
		}
		return this.deliver(
			subscriber.target,
			CONFIRM_TEMPLATE,
			{
				siteName: settings.siteName,
				confirmUrl: confirmUrl(subscriber, settings, this.siteUrl),
			},
			AirhornSendType.Email,
			{ from: this.email.from },
		);
	}

	private async deliver(
		to: string,
		template: typeof EMAIL_TEMPLATE,
		data: Record<string, unknown>,
		type: AirhornSendType,
		options?: Record<string, unknown>,
	): Promise<boolean> {
		try {
			const result = await this.airhorn.send(to, template, data, type, options);
			if (!result.success) {
				const reason = result.errors
					.map((entry) => entry.error.message)
					.join("; ");
				this.onError(new Error(`Failed to send ${type} to ${to}: ${reason}`));
			}
			return result.success;
		} catch (error) {
			this.onError(error instanceof Error ? error : new Error(String(error)));
			return false;
		}
	}
}

/** Builds Airhorn providers from configuration. Providers are loaded lazily. */
export async function createProviders(
	config: Pick<Config, "email" | "twilio" | "aws" | "webhookSecret">,
): Promise<AirhornProvider[]> {
	const providers: AirhornProvider[] = [
		new WebhookProvider({ secret: config.webhookSecret }),
	];
	if (config.email?.provider === "sendgrid" && config.twilio?.sendGridApiKey) {
		const { AirhornTwilio } = await import("@airhornjs/twilio");
		providers.push(new AirhornTwilio(config.twilio));
	}
	if (config.email?.provider === "ses" && config.aws) {
		const { AirhornAws } = await import("@airhornjs/aws");
		providers.push(
			new AirhornAws({ ...config.aws, capabilities: [AirhornSendType.Email] }),
		);
	}
	return providers;
}

export async function createNotifier(config: Config): Promise<AirhornNotifier> {
	const providers = await createProviders(config);
	const emailProvider = providers.some((provider) =>
		provider.capabilities.includes(AirhornSendType.Email),
	);
	const airhorn = new Airhorn({ providers, useWebhookProvider: false });
	return new AirhornNotifier({
		airhorn,
		email: emailProvider ? config.email : undefined,
		siteUrl: config.siteUrl,
	});
}
