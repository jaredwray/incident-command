import { z } from "zod";
import {
	DELIVERY_STRATEGIES,
	INCIDENT_IMPACTS,
	INCIDENT_KINDS,
	INCIDENT_STATUSES,
	type IncidentKind,
	MAINTENANCE_STATUSES,
	PROVIDER_TYPES,
	ROLES,
	SERVICE_STATUSES,
	SUBSCRIBER_TYPES,
} from "./types";

/** Optional text where an empty string means "not set". */
const text = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((value) => (value === "" ? undefined : value))
		.optional();

/** Patch text: `undefined` leaves the value alone, `null` or `""` clears it. */
const patchText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullable()
		.optional()
		.transform((value) => (value === "" ? null : value));

const patchUrl = z
	.union([z.literal(""), z.url({ protocol: /^https?$/ })])
	.nullable()
	.optional()
	.transform((value) => (value === "" ? null : value));

/** ISO 8601 timestamp (any offset), normalized to UTC so stored values sort and display consistently. */
const isoDate = z.iso
	.datetime({ offset: true })
	.transform((value) => new Date(value).toISOString());

export const serviceStatusSchema = z.enum(SERVICE_STATUSES);
export const eventStatusSchema = z.enum([
	...INCIDENT_STATUSES,
	...MAINTENANCE_STATUSES,
]);
export const impactSchema = z.enum(INCIDENT_IMPACTS);
export const roleSchema = z.enum(ROLES);
export const kindSchema = z.enum(INCIDENT_KINDS);

export const createServiceSchema = z.object({
	name: z.string().trim().min(1).max(120),
	description: text(500),
	group: text(80),
	status: serviceStatusSchema.optional(),
	order: z.number().int().optional(),
	hidden: z.boolean().optional(),
});
export type CreateServiceInput = z.input<typeof createServiceSchema>;

export const updateServiceSchema = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	description: patchText(500),
	group: patchText(80),
	status: serviceStatusSchema.optional(),
	order: z.number().int().optional(),
	hidden: z.boolean().optional(),
});
export type UpdateServiceInput = z.input<typeof updateServiceSchema>;

export const createIncidentSchema = z.object({
	kind: kindSchema.optional(),
	title: z.string().trim().min(1).max(200),
	message: z.string().trim().min(1).max(10_000),
	status: eventStatusSchema.optional(),
	impact: impactSchema.optional(),
	serviceIds: z.array(z.string().min(1)).max(100).optional(),
	serviceStatus: serviceStatusSchema.optional(),
	scheduledStart: isoDate.optional(),
	scheduledEnd: isoDate.optional(),
	notify: z.boolean().optional(),
});
export type CreateIncidentInput = z.input<typeof createIncidentSchema>;

export const incidentUpdateSchema = z.object({
	status: eventStatusSchema.optional(),
	message: z.string().trim().min(1).max(10_000),
	serviceStatus: serviceStatusSchema.optional(),
	notify: z.boolean().optional(),
});
export type IncidentUpdateInput = z.input<typeof incidentUpdateSchema>;

export const editIncidentSchema = z.object({
	title: z.string().trim().min(1).max(200).optional(),
	impact: impactSchema.optional(),
	serviceIds: z.array(z.string().min(1)).max(100).optional(),
	scheduledStart: isoDate.optional(),
	scheduledEnd: isoDate.optional(),
});
export type EditIncidentInput = z.input<typeof editIncidentSchema>;

/**
 * The content of a notification draft. The incident schemas check it each
 * time the draft is saved, so a saved draft can always be published.
 */
export type DraftContentInput = Omit<
	CreateIncidentInput,
	"kind" | "title" | "notify"
> & { title?: string };

/** A new notification draft. With `incidentId`, the draft is an update to that incident. */
export type NotificationDraftInput = DraftContentInput & {
	incidentId?: string;
	kind?: IncidentKind;
};

const password = z.string().min(8).max(200);
const email = z
	.email()
	.max(254)
	.transform((value) => value.toLowerCase());

export const createMemberSchema = z.object({
	email,
	name: z.string().trim().min(1).max(120),
	role: roleSchema,
	password,
});
export type CreateMemberInput = z.input<typeof createMemberSchema>;

export const createInviteSchema = z.object({
	email,
	role: roleSchema.optional(),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
	name: z.string().trim().min(1).max(120),
	password,
});
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;

export const updateMemberSchema = z.object({
	email: email.optional(),
	name: z.string().trim().min(1).max(120).optional(),
	role: roleSchema.optional(),
	password: password.optional(),
});
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

export const loginSchema = z.object({
	email,
	password: z.string().min(1).max(200),
});

export const createAgentSchema = z.object({
	name: z.string().trim().min(1).max(120),
	description: text(500),
	role: roleSchema.optional(),
	expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type CreateAgentInput = z.input<typeof createAgentSchema>;

export const updateSettingsSchema = z.object({
	siteName: z.string().trim().min(1).max(120).optional(),
	description: z.string().trim().max(500).optional(),
	siteUrl: patchUrl,
	logoUrl: patchUrl,
	faviconUrl: patchUrl,
	supportUrl: patchUrl,
	theme: z
		.string()
		.trim()
		.regex(/^[a-z0-9-]+$/)
		.max(40)
		.optional(),
	brandColor: z
		.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)])
		.nullable()
		.optional()
		.transform((value) => (value === "" ? null : value)),
	customCss: patchText(50_000),
	allowSubscriptions: z.boolean().optional(),
	uptimeDays: z.number().int().min(7).max(365).optional(),
});
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;

export const subscribeSchema = z.object({ email });

const PHONE = /^\+[1-9][0-9]{6,14}$/;

/** True for a phone number in E.164 format, such as `+15551234567`. */
export function isPhoneNumber(value: string): boolean {
	return PHONE.test(value);
}
const PHONE_MESSAGE =
	"Use a phone number in E.164 format, such as +15551234567";

/** A phone number in E.164 format. Spaces, dashes, dots and parentheses are removed. */
const phone = z
	.string()
	.transform((value) => value.replace(/[\s().-]/g, ""))
	.pipe(z.string().regex(PHONE, PHONE_MESSAGE));

export const smsSubscriberSchema = z.object({ phone });

export const webhookSubscriberSchema = z.object({
	url: z.url({ protocol: /^https?$/ }).max(2000),
});

export const emailSubscriberSchema = z.object({ email });

export const notificationChannelSchema = z.enum(SUBSCRIBER_TYPES);

const NAMED_ADDRESS = /^([^<>"\r\n]{1,100}?)\s*<([^<>\s]+)>$/;

/** Splits `Status <status@example.com>` into a name and an address. */
export function splitAddress(value: string): { name?: string; email: string } {
	const match = NAMED_ADDRESS.exec(value.trim());
	// Both groups match at least one character.
	return match
		? { name: match[1] as string, email: match[2] as string }
		: { email: value.trim() };
}

/** Validates a sender. Only the email and text messaging channels have a sender. */
export const senderSchemas = {
	email: z
		.string()
		.refine(
			(value) => z.email().safeParse(splitAddress(value).email).success,
			"Use an email address, optionally with a name: Status <status@example.com>",
		),
	sms: z
		.string()
		.refine(
			(value) =>
				PHONE.test(value) || /^(?=.*[A-Za-z])[A-Za-z0-9]{1,11}$/.test(value),
			"Use a phone number in E.164 format or a sender ID of up to 11 letters and digits",
		),
} as const;

/**
 * The revision that a form showed. A save with an old revision fails, so a
 * form that is out of date cannot undo the change of a different admin.
 */
const expectedRevision = z.number().int().nonnegative().optional();

export const updateNotificationChannelSchema = z.object({
	revision: expectedRevision,
	enabled: z.boolean().optional(),
	strategy: z.enum(DELIVERY_STRATEGIES).optional(),
	from: patchText(200),
});
export type UpdateNotificationChannelInput = z.input<
	typeof updateNotificationChannelSchema
>;

/** Field values of a provider, keyed by field. */
const providerValues = z
	.record(z.string().regex(/^[A-Za-z]{1,40}$/), z.string().trim().max(4000))
	.optional();

export const addNotificationProviderSchema = z.object({
	type: z.enum(PROVIDER_TYPES),
	name: z.string().trim().min(1).max(80),
	from: text(200),
	values: providerValues,
});
export type AddNotificationProviderInput = z.input<
	typeof addNotificationProviderSchema
>;

export const updateNotificationProviderSchema = z.object({
	revision: expectedRevision,
	name: z.string().trim().min(1).max(80).optional(),
	from: patchText(200),
	/** A secret field with an empty value keeps its stored value. */
	values: providerValues,
	/** The secret fields to delete. */
	clear: z.array(z.string()).max(20).optional(),
});
export type UpdateNotificationProviderInput = z.input<
	typeof updateNotificationProviderSchema
>;

export const moveDirectionSchema = z.enum(["up", "down"]);
export type MoveDirection = z.infer<typeof moveDirectionSchema>;
