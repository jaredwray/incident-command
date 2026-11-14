import type {
	DeliveryStrategy,
	NotificationChannel,
	ProviderType,
} from "../domain/types";

/** A setting or credential that a provider type needs. */
export interface ProviderField {
	key: string;
	label: string;
	/** Encrypted in the store and never shown again. */
	secret?: boolean;
	required?: boolean;
	/** An anchored regular expression for the value (also the HTML `pattern`). */
	pattern?: string;
	placeholder?: string;
	hint?: string;
}

export interface ProviderDefinition {
	type: ProviderType;
	channel: NotificationChannel;
	label: string;
	description: string;
	fields: readonly ProviderField[];
	/** Groups of fields that must all have a value, or all be empty. */
	together?: readonly (readonly string[])[];
}

const AWS_REGION = "[a-z]{2}(-[a-z]+)+-[0-9]";

const awsFields = (service: string): ProviderField[] => [
	{
		key: "region",
		label: "Region",
		required: true,
		pattern: AWS_REGION,
		placeholder: "us-east-1",
	},
	{
		key: "accessKeyId",
		label: "Access key ID",
		pattern: "[A-Z0-9]{16,128}",
		placeholder: "AKIA…",
		hint: `Leave both keys empty to use the IAM role of the server. The role needs access to ${service}.`,
	},
	{ key: "secretAccessKey", label: "Secret access key", secret: true },
];

export const PROVIDERS: Record<ProviderType, ProviderDefinition> = {
	webhook: {
		type: "webhook",
		channel: "webhook",
		label: "Signed webhook",
		description:
			"Posts the JSON payload to each webhook subscriber, optionally signed.",
		fields: [
			{
				key: "signingSecret",
				label: "Signing secret",
				secret: true,
				hint: "Signs each body with HMAC-SHA256 in the x-incident-command-signature header.",
			},
			{
				key: "timeoutSeconds",
				label: "Timeout (seconds)",
				pattern: "[1-9]|[1-5][0-9]|60",
				placeholder: "10",
				hint: "From 1 to 60. The default is 10.",
			},
		],
	},
	sendgrid: {
		type: "sendgrid",
		channel: "email",
		label: "SendGrid",
		description: "Sends email through the SendGrid v3 API.",
		fields: [
			{
				key: "apiKey",
				label: "API key",
				secret: true,
				required: true,
				placeholder: "SG.…",
				hint: "The key needs the Mail Send permission.",
			},
		],
	},
	ses: {
		type: "ses",
		channel: "email",
		label: "Amazon SES",
		description: "Sends email through Amazon Simple Email Service.",
		fields: awsFields("ses:SendEmail"),
		together: [["accessKeyId", "secretAccessKey"]],
	},
	twilio: {
		type: "twilio",
		channel: "sms",
		label: "Twilio",
		description: "Sends text messages through Twilio Programmable Messaging.",
		fields: [
			{
				key: "accountSid",
				label: "Account SID",
				required: true,
				pattern: "AC[0-9a-fA-F]{32}",
				placeholder: "AC…",
			},
			{ key: "authToken", label: "Auth token", secret: true, required: true },
		],
	},
	sns: {
		type: "sns",
		channel: "sms",
		label: "Amazon SNS",
		description:
			"Sends text messages through Amazon Simple Notification Service.",
		fields: awsFields("sns:Publish"),
		together: [["accessKeyId", "secretAccessKey"]],
	},
};

export interface ChannelDefinition {
	label: string;
	/** The singular noun of one notification, such as "text message". */
	noun: string;
	description: string;
	/** The provider types that can send on this channel, in display order. */
	providers: readonly ProviderType[];
	/** The sender field. A channel without it sends without a sender. */
	sender?: {
		label: string;
		/** The label of the default sender of the channel. */
		defaultLabel: string;
		placeholder: string;
		hint: string;
	};
}

export const CHANNELS: Record<NotificationChannel, ChannelDefinition> = {
	webhook: {
		label: "Webhooks",
		noun: "webhook",
		description:
			"Posts a JSON payload to each webhook subscriber (Slack, Discord or any endpoint).",
		providers: ["webhook"],
	},
	email: {
		label: "Email",
		noun: "email",
		description:
			"Emails each email subscriber and sends the confirmation email of the public subscribe form.",
		providers: ["sendgrid", "ses"],
		sender: {
			label: "From address",
			defaultLabel: "Default from address",
			placeholder: "Status <status@example.com>",
			hint: "An address that the provider verified, optionally with a name.",
		},
	},
	sms: {
		label: "Text messaging",
		noun: "text message",
		description: "Sends a short text message to each phone subscriber.",
		providers: ["twilio", "sns"],
		sender: {
			label: "From number or sender ID",
			defaultLabel: "Default from number or sender ID",
			placeholder: "+15551234567",
			hint: "A phone number in E.164 format, or an alphanumeric sender ID of up to 11 characters.",
		},
	},
};

export const STRATEGIES: Record<
	DeliveryStrategy,
	{ label: string; description: string }
> = {
	active_passive: {
		label: "Active/passive",
		description:
			"Sends through the first provider. The next provider sends only when a send fails.",
	},
	load_balanced: {
		label: "Load balanced",
		description:
			"Sends each message through the next provider in turn. A failed send does not go to a different provider.",
	},
};

/** True when the value matches the whole pattern of the field. */
export function matchesField(field: ProviderField, value: string): boolean {
	return (
		field.pattern === undefined ||
		new RegExp(`^(?:${field.pattern})$`).test(value)
	);
}
