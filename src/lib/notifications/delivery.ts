import type { Config } from "../config";
import type {
	DeliveryStrategy,
	NotificationChannel,
	ProviderType,
} from "../domain/types";

/** A provider with decrypted credentials, ready to send. Never stored or rendered. */
export interface ResolvedProvider {
	id: string;
	type: ProviderType;
	name: string;
	/** The sender: the sender of the provider, else the sender of the channel. */
	from?: string;
	options: Record<string, string>;
	secrets: Record<string, string>;
}

/** The delivery settings of a channel, ready for the notifier. */
export interface DeliveryChannel {
	channel: NotificationChannel;
	enabled: boolean;
	strategy: DeliveryStrategy;
	providers: ResolvedProvider[];
	/** Changes when the settings change. The notifier keeps its airhorn instance until then. */
	version: string;
}

export type DeliveryChannels = Record<NotificationChannel, DeliveryChannel>;

/** True when the channel is on and has a provider. */
export function canDeliver(channel: DeliveryChannel): boolean {
	return channel.enabled && channel.providers.length > 0;
}

/**
 * The providers that environment variables configure. A channel uses them
 * only when an admin added no providers to it in the portal, so existing
 * deployments keep their configuration. Webhooks always have the built-in
 * provider, signed when `WEBHOOK_SECRET` is set.
 */
export function environmentProviders(
	config: Pick<
		Config,
		"webhookSecret" | "emailProvider" | "sendGridApiKey" | "aws"
	>,
	channel: NotificationChannel,
): ResolvedProvider[] {
	if (channel === "webhook") {
		return [
			{
				id: "env_webhook",
				type: "webhook",
				name: "Built-in webhook sender",
				options: {},
				secrets: config.webhookSecret
					? { signingSecret: config.webhookSecret }
					: {},
			},
		];
	}
	if (channel === "email") {
		if (config.emailProvider === "sendgrid" && config.sendGridApiKey) {
			return [
				{
					id: "env_email",
					type: "sendgrid",
					name: "SendGrid (environment variables)",
					options: {},
					secrets: { apiKey: config.sendGridApiKey },
				},
			];
		}
		if (config.emailProvider === "ses" && config.aws) {
			const { region, accessKeyId, secretAccessKey } = config.aws;
			const keys = accessKeyId && secretAccessKey;
			return [
				{
					id: "env_email",
					type: "ses",
					name: "Amazon SES (environment variables)",
					options: keys ? { region, accessKeyId } : { region },
					secrets: keys ? { secretAccessKey } : {},
				},
			];
		}
	}
	return [];
}
