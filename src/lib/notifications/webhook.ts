import type {
	AirhornProvider,
	AirhornProviderMessage,
	AirhornProviderSendResult,
	AirhornSendType,
} from "airhorn";
import { hmacSha256 } from "../crypto";

export const SIGNATURE_HEADER = "x-incident-command-signature";

export interface WebhookProviderOptions {
	/** When set, requests carry an HMAC-SHA256 signature of the body. */
	secret?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

/**
 * Airhorn webhook provider that posts the rendered template content as the raw
 * JSON body (Slack, Discord and generic receivers all understand the payload)
 * and optionally signs it so receivers can verify the sender.
 */
export class WebhookProvider implements AirhornProvider {
	readonly name = "incident-command-webhook";
	readonly capabilities = ["webhook" as AirhornSendType];
	private readonly options: WebhookProviderOptions;

	constructor(options: WebhookProviderOptions = {}) {
		this.options = options;
	}

	async send(
		message: AirhornProviderMessage,
	): Promise<AirhornProviderSendResult> {
		const body = message.content;
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"user-agent": "incident-command",
		};
		if (this.options.secret) {
			headers[SIGNATURE_HEADER] =
				`sha256=${hmacSha256(this.options.secret, body)}`;
		}
		const doFetch = this.options.fetch ?? fetch;
		try {
			const response = await doFetch(message.to, {
				method: "POST",
				headers,
				body,
				signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
			});
			return {
				success: response.ok,
				response: { status: response.status },
				errors: response.ok
					? []
					: [new Error(`Webhook responded with status ${response.status}`)],
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			return {
				success: false,
				response: { error: err.message },
				errors: [err],
			};
		}
	}
}
