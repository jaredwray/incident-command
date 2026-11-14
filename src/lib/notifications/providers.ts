import type {
	Airhorn,
	AirhornProvider,
	AirhornProviderMessage,
	AirhornProviderSendResult,
	AirhornSendType,
} from "airhorn";
import { errorMessage } from "../errors";
import type { DeliveryChannel, ResolvedProvider } from "./delivery";
import { SendGridProvider } from "./sendgrid";
import { WebhookProvider } from "./webhook";

/**
 * Wraps a provider of a channel. The airhorn name becomes the name that the
 * admin gave, so errors say which provider failed. The provider only offers
 * the send type of its channel, and its sender replaces the message sender.
 */
export class ChannelProvider implements AirhornProvider {
	readonly name: string;
	readonly capabilities: AirhornSendType[];
	private readonly inner: AirhornProvider;
	private readonly from?: string;

	constructor(
		name: string,
		type: AirhornSendType,
		inner: AirhornProvider,
		from?: string,
	) {
		this.name = name;
		this.capabilities = [type];
		this.inner = inner;
		this.from = from;
	}

	send(
		message: AirhornProviderMessage,
		options?: unknown,
	): Promise<AirhornProviderSendResult> {
		return this.inner.send(
			this.from ? { ...message, from: this.from } : message,
			options,
		);
	}
}

function awsCredentials(provider: ResolvedProvider) {
	return {
		region: provider.options.region as string,
		accessKeyId: provider.options.accessKeyId,
		secretAccessKey: provider.secrets.secretAccessKey,
	};
}

/** Builds the airhorn provider for a provider config. SDKs load on first use. */
export async function createProvider(
	provider: ResolvedProvider,
): Promise<AirhornProvider> {
	switch (provider.type) {
		case "webhook": {
			const seconds = Number(provider.options.timeoutSeconds);
			return new WebhookProvider({
				secret: provider.secrets.signingSecret,
				timeoutMs: seconds > 0 ? seconds * 1000 : undefined,
			});
		}
		case "sendgrid":
			return new SendGridProvider({
				apiKey: provider.secrets.apiKey as string,
			});
		case "ses":
		case "sns": {
			const { AirhornAws } = await import("@airhornjs/aws");
			return new AirhornAws({
				...awsCredentials(provider),
				capabilities: [
					(provider.type === "ses" ? "email" : "sms") as AirhornSendType,
				],
			});
		}
		case "twilio": {
			const { AirhornTwilio } = await import("@airhornjs/twilio");
			return new AirhornTwilio({
				accountSid: provider.options.accountSid as string,
				authToken: provider.secrets.authToken as string,
			});
		}
	}
}

const STRATEGY = {
	active_passive: "FailOver",
	load_balanced: "RoundRobin",
} as const;

/**
 * Creates the airhorn instance of a channel. Each channel has its own
 * instance, so each has its own send strategy and round-robin position. A
 * provider that cannot be built is left out and reported.
 */
export async function createChannelAirhorn(
	channel: DeliveryChannel,
	onError: (error: Error) => void,
): Promise<Airhorn> {
	const type = channel.channel as AirhornSendType;
	const [{ Airhorn }, ...built] = await Promise.all([
		import("airhorn"),
		...channel.providers.map(async (provider) => {
			try {
				return new ChannelProvider(
					provider.name,
					type,
					await createProvider(provider),
					provider.from,
				);
			} catch (error) {
				onError(
					new Error(
						`Cannot use provider "${provider.name}": ${errorMessage(error)}`,
					),
				);
				return undefined;
			}
		}),
	]);
	return new Airhorn({
		providers: built.filter((provider) => provider !== undefined),
		useWebhookProvider: false,
		sendStrategy: STRATEGY[channel.strategy] as Airhorn["sendStrategy"],
	});
}
