import type {
	AirhornProvider,
	AirhornProviderMessage,
	AirhornProviderSendResult,
	AirhornSendType,
} from "airhorn";
import { splitAddress } from "../domain/schemas";

export const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

export interface SendGridProviderOptions {
	apiKey: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

function failure(error: Error, response: unknown): AirhornProviderSendResult {
	return { success: false, response, errors: [error] };
}

/**
 * Airhorn email provider for the SendGrid v3 API. airhorn's Twilio provider
 * keeps one SendGrid key for the whole process, so two SendGrid providers
 * would share one key. This provider keeps the key per instance.
 */
export class SendGridProvider implements AirhornProvider {
	readonly name = "sendgrid";
	readonly capabilities = ["email" as AirhornSendType];
	private readonly options: SendGridProviderOptions;

	constructor(options: SendGridProviderOptions) {
		this.options = options;
	}

	async send(
		message: AirhornProviderMessage,
		options?: { text?: string },
	): Promise<AirhornProviderSendResult> {
		if (!message.from) {
			return failure(new Error("SendGrid needs a from address"), null);
		}
		const doFetch = this.options.fetch ?? fetch;
		try {
			const response = await doFetch(SENDGRID_URL, {
				method: "POST",
				headers: {
					authorization: `Bearer ${this.options.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					personalizations: [{ to: [{ email: message.to }] }],
					from: splitAddress(message.from),
					subject: message.subject || "Notification",
					content: [
						{ type: "text/plain", value: options?.text ?? message.content },
						{ type: "text/html", value: message.content },
					],
				}),
				signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
			});
			if (!response.ok) {
				const body = (await response.text()).slice(0, 500);
				return failure(
					new Error(`SendGrid responded with status ${response.status}`),
					{ status: response.status, body },
				);
			}
			return {
				success: true,
				response: {
					status: response.status,
					messageId: response.headers.get("x-message-id") ?? undefined,
				},
				errors: [],
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			return failure(err, { error: err.message });
		}
	}
}
