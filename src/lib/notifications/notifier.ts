import type {
	Airhorn,
	AirhornProviderSendResult,
	AirhornSendResult,
	AirhornTemplate,
} from "airhorn";
import type { Config } from "../config";
import type {
	NotificationChannel,
	Settings,
	Subscriber,
} from "../domain/types";
import { errorMessage } from "../errors";
import {
	canDeliver,
	type DeliveryChannel,
	type DeliveryChannels,
} from "./delivery";
import {
	CONFIRM_TEMPLATE,
	confirmationPayload,
	confirmationText,
	confirmUrl,
	EMAIL_TEMPLATE,
	emailData,
	type IncidentNotification,
	SMS_TEMPLATE,
	smsText,
	summaryText,
	WEBHOOK_TEMPLATE,
	webhookPayload,
} from "./templates";

export interface NotifyResult {
	sent: number;
	failed: number;
}

/**
 * Sends subscriber notifications. Services depend on this interface only.
 * The caller passes the delivery settings, so a change in the portal applies
 * to the next send.
 */
export interface Notifier {
	notifyIncident(
		notification: IncidentNotification,
		subscribers: Subscriber[],
		channels: DeliveryChannels,
		onResult?: (subscriber: Subscriber, ok: boolean) => Promise<void> | void,
	): Promise<NotifyResult>;
	sendConfirmation(
		subscriber: Subscriber,
		settings: Settings,
		channel: DeliveryChannel,
	): Promise<boolean>;
}

export interface AirhornNotifierOptions {
	siteUrl?: string;
	concurrency?: number;
	onError?: (error: Error) => void;
}

/**
 * Loads airhorn, the provider SDKs and the providers on the first send. That
 * load takes more than 0.5 s and approximately 85 MiB. The container starts
 * again after each sleep, so a page request must not wait for it. Do not
 * import `providers.ts` or a provider file from other code, because that
 * loads airhorn when the server starts.
 */
const loadProviders = () => import("./providers");

/**
 * Why a send failed. Fail-over lists an error for each provider. Round-robin
 * keeps the result of its one provider in `response` instead.
 */
function failureReason(result: AirhornSendResult): string {
	const errors =
		result.errors.length > 0
			? result.errors
			: (result.response as AirhornProviderSendResult).errors.map((error) => ({
					provider: result.providers[0],
					error,
				}));
	return (
		errors
			.map(({ provider, error }) =>
				provider ? `${provider.name}: ${error.message}` : error.message,
			)
			.join("; ") || "the provider gave no reason"
	);
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

/**
 * Notifier backed by airhorn. Each channel has its own airhorn instance with
 * the providers and the send strategy of that channel. The instance stays
 * until the channel settings change, so round-robin keeps its position.
 */
export class AirhornNotifier implements Notifier {
	private readonly siteUrl?: string;
	private readonly concurrency: number;
	private readonly onError: (error: Error) => void;
	private readonly instances = new Map<
		NotificationChannel,
		{ version: string; airhorn: Airhorn }
	>();

	constructor(options: AirhornNotifierOptions = {}) {
		this.siteUrl = options.siteUrl;
		this.concurrency = options.concurrency ?? 10;
		this.onError =
			options.onError ??
			((error) => console.error(`[notifications] ${error.message}`));
	}

	/** The airhorn instance of a channel. A new one replaces it when the settings change. */
	async airhorn(channel: DeliveryChannel): Promise<Airhorn> {
		const { createChannelAirhorn } = await loadProviders();
		const cached = this.instances.get(channel.channel);
		if (cached?.version === channel.version) {
			return cached.airhorn;
		}
		const airhorn = createChannelAirhorn(channel, this.onError);
		this.instances.set(channel.channel, { version: channel.version, airhorn });
		return airhorn;
	}

	async notifyIncident(
		notification: IncidentNotification,
		subscribers: Subscriber[],
		channels: DeliveryChannels,
		onResult?: (subscriber: Subscriber, ok: boolean) => Promise<void> | void,
	): Promise<NotifyResult> {
		const withSiteUrl = { ...notification, siteUrl: this.siteUrl };
		const recipients = subscribers.filter(
			(subscriber) =>
				subscriber.confirmed && canDeliver(channels[subscriber.type]),
		);
		const payload = JSON.stringify(webhookPayload(withSiteUrl));
		const text = summaryText(withSiteUrl);
		const sms = smsText(withSiteUrl);
		const results = await mapLimit(
			recipients,
			this.concurrency,
			async (subscriber) => {
				const channel = channels[subscriber.type];
				const ok = await (async () => {
					switch (subscriber.type) {
						case "webhook":
							return this.deliver(
								channel,
								subscriber.target,
								WEBHOOK_TEMPLATE,
								{
									payload,
								},
							);
						case "sms":
							return this.deliver(channel, subscriber.target, SMS_TEMPLATE, {
								text: sms,
							});
						case "email":
							return this.deliver(
								channel,
								subscriber.target,
								EMAIL_TEMPLATE,
								emailData(withSiteUrl, subscriber),
								{ text },
							);
					}
				})();
				if (onResult) {
					await onResult(subscriber, ok);
				}
				return ok;
			},
		);
		const sent = results.filter(Boolean).length;
		return { sent, failed: results.length - sent };
	}

	/** Sends the confirmation link through the channel of the subscriber. */
	async sendConfirmation(
		subscriber: Subscriber,
		settings: Settings,
		channel: DeliveryChannel,
	): Promise<boolean> {
		if (channel.channel !== subscriber.type || !canDeliver(channel)) {
			return false;
		}
		switch (subscriber.type) {
			case "email":
				return this.deliver(channel, subscriber.target, CONFIRM_TEMPLATE, {
					siteName: settings.siteName,
					confirmUrl: confirmUrl(subscriber, settings, this.siteUrl),
				});
			case "sms":
				return this.deliver(channel, subscriber.target, SMS_TEMPLATE, {
					text: confirmationText(subscriber, settings, this.siteUrl),
				});
			case "webhook":
				return this.deliver(channel, subscriber.target, WEBHOOK_TEMPLATE, {
					payload: JSON.stringify(
						confirmationPayload(subscriber, settings, this.siteUrl),
					),
				});
		}
	}

	/**
	 * Sends one message. Extra `options` go to the provider; text messages
	 * get none, because the SNS provider copies them into its request.
	 * airhorn reports a failed send in its result. Only a failed load of the
	 * providers throws, and it affects only this send.
	 */
	private async deliver(
		channel: DeliveryChannel,
		to: string,
		template: AirhornTemplate,
		data: Record<string, unknown>,
		options?: Record<string, unknown>,
	): Promise<boolean> {
		try {
			const { SEND_TYPE } = await loadProviders();
			const airhorn = await this.airhorn(channel);
			const result = await airhorn.send(
				to,
				template,
				data,
				SEND_TYPE[channel.channel],
				options,
			);
			if (!result.success) {
				this.onError(
					new Error(
						`Failed to send ${channel.channel} to ${to}: ${failureReason(result)}`,
					),
				);
			}
			return result.success;
		} catch (error) {
			this.onError(new Error(errorMessage(error), { cause: error }));
			return false;
		}
	}
}

/** Creates the notifier. airhorn loads when the first notification is sent. */
export function createNotifier(
	config: Pick<Config, "siteUrl">,
): AirhornNotifier {
	return new AirhornNotifier({ siteUrl: config.siteUrl });
}
