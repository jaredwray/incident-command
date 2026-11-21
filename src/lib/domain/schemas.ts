import { z } from "zod";
import {
	DELIVERY_STRATEGIES,
	INCIDENT_IMPACTS,
	INCIDENT_KINDS,
	INCIDENT_STATUSES,
	type IncidentKind,
	MAINTENANCE_STATUSES,
	PROVIDER_TYPES,
	QUEUE_PROVIDER_IDS,
	ROLES,
	SERVICE_STATUSES,
	type ServiceRegions,
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

/**
 * Statuses for single affected services. Each status replaces `serviceStatus`
 * and the automatic status for its service. An empty list is not set.
 */
const serviceStatusesSchema = z
	.array(
		z.object({ serviceId: z.string().min(1), status: serviceStatusSchema }),
	)
	.max(100)
	.refine(
		(entries) =>
			new Set(entries.map((entry) => entry.serviceId)).size === entries.length,
		"Give each service only one status",
	)
	.optional()
	.transform((entries) => (entries?.length ? entries : undefined));

export const createRegionSchema = z.object({
	name: z.string().trim().min(1).max(80),
	order: z.number().int().optional(),
});
export type CreateRegionInput = z.input<typeof createRegionSchema>;

export const updateRegionSchema = z.object({
	name: z.string().trim().min(1).max(80).optional(),
	order: z.number().int().optional(),
});
export type UpdateRegionInput = z.input<typeof updateRegionSchema>;

const serviceRegionEntry = z.object({
	serviceId: z.string().min(1),
	regionIds: z.array(z.string().trim().min(1)).max(100),
});

/**
 * Regions for each affected service.
 * An empty `regionIds` list means Global for that service.
 * An empty list of services means every service is Global.
 */
const serviceRegionsSchema = z
	.array(serviceRegionEntry)
	.max(100)
	.refine(
		(entries) =>
			new Set(entries.map((entry) => entry.serviceId)).size === entries.length,
		"Give each service only one region list",
	);

function cleanServiceRegions(
	entries: { serviceId: string; regionIds: string[] }[] | null | undefined,
): ServiceRegions[] | null | undefined {
	if (entries == null) {
		return entries;
	}
	return entries.map((entry) => ({
		serviceId: entry.serviceId,
		regionIds: [...new Set(entry.regionIds)],
	}));
}

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
	serviceStatuses: serviceStatusesSchema,
	serviceRegions: serviceRegionsSchema
		.optional()
		.transform((entries) => cleanServiceRegions(entries)),
	scheduledStart: isoDate.optional(),
	scheduledEnd: isoDate.optional(),
	notify: z.boolean().optional(),
});
export type CreateIncidentInput = z.input<typeof createIncidentSchema>;

export const incidentUpdateSchema = z.object({
	title: z.string().trim().min(1).max(200).optional(),
	impact: impactSchema.optional(),
	status: eventStatusSchema.optional(),
	message: z.string().trim().min(1).max(10_000),
	/** Services to add. This does not remove a service. */
	serviceIds: z.array(z.string().min(1)).max(100).optional(),
	serviceStatus: serviceStatusSchema.optional(),
	serviceStatuses: serviceStatusesSchema,
	/**
	 * Regions for services in this update.
	 * A service that is not in this list keeps its regions.
	 * An empty `regionIds` list makes that service Global.
	 */
	serviceRegions: serviceRegionsSchema
		.optional()
		.transform((entries) => cleanServiceRegions(entries)),
	notify: z.boolean().optional(),
});
export type IncidentUpdateInput = z.input<typeof incidentUpdateSchema>;

export const editIncidentSchema = z.object({
	serviceIds: z.array(z.string().min(1)).max(100).optional(),
	scheduledStart: isoDate.optional(),
	scheduledEnd: isoDate.optional(),
	/**
	 * Replaces the regions of every affected service.
	 * `null` or `[]` makes every service Global.
	 * Omit the field to keep the current regions.
	 */
	serviceRegions: serviceRegionsSchema
		.nullable()
		.optional()
		.transform((entries) => cleanServiceRegions(entries)),
});
export type EditIncidentInput = z.input<typeof editIncidentSchema>;

/** The reason for a deletion from the public view. */
export const deleteIncidentSchema = z.object({
	reason: z.string().trim().max(1000),
});
export type DeleteIncidentInput = z.input<typeof deleteIncidentSchema>;

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
	requestId?: string;
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
	permissions: z.array(z.string()).optional(),
});
export type CreateAgentInput = z.input<typeof createAgentSchema>;

export const updateAgentSchema = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	description: z
		.string()
		.trim()
		.max(500)
		.nullable()
		.optional()
		.transform((value) => (value === "" ? null : value)),
	permissions: z.array(z.string()).optional(),
	revision: z.number().int().nonnegative(),
});
export type UpdateAgentInput = z.input<typeof updateAgentSchema>;

export const createAgentTokenSchema = z.object({
	expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type CreateAgentTokenInput = z.input<typeof createAgentTokenSchema>;

/** Client metadata for dynamic client registration (RFC 7591). The service ignores other fields. */
export const registerClientSchema = z.object({
	redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
	client_name: z.string().trim().max(120).optional(),
});

/** The largest custom stylesheet that the settings accept, in characters. */
export const CUSTOM_CSS_MAX_LENGTH = 50_000;

export const updateSettingsSchema = z.object({
	siteName: z.string().trim().min(1).max(120).optional(),
	description: z.string().trim().max(500).optional(),
	siteUrl: patchUrl,
	supportUrl: patchUrl,
	theme: z
		.string()
		.trim()
		.regex(/^[a-z0-9-]+$/)
		.max(40)
		.optional(),
	customCss: patchText(CUSTOM_CSS_MAX_LENGTH),
	showPoweredBy: z.boolean().optional(),
	requireTwoFactor: z.boolean().optional(),
	uptimeDays: z.number().int().min(7).max(365).optional(),
});
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;

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

const webhookUrl = z.url({ protocol: /^https?$/ }).max(2000);

/**
 * Services that send a notification to one subscriber.
 * An empty list means every service. Give each service only once.
 */
export const subscriberServiceIdsSchema = z
	.array(z.string().trim().min(1))
	.max(100)
	.refine(
		(ids) => new Set(ids).size === ids.length,
		"Give each service only once",
	);

/** Replaces the service choice of one subscriber. */
export const subscriberServicesSchema = z.object({
	serviceIds: subscriberServiceIdsSchema,
});

/** A public subscription. The format of `target` follows `type`. */
export const subscribeSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("email"),
		target: email,
		serviceIds: subscriberServiceIdsSchema.optional(),
	}),
	z.object({
		type: z.literal("sms"),
		target: phone,
		serviceIds: subscriberServiceIdsSchema.optional(),
	}),
	z.object({
		type: z.literal("webhook"),
		target: webhookUrl,
		serviceIds: subscriberServiceIdsSchema.optional(),
	}),
]);

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

export const updateNotificationQueueSchema = z.object({
	revision: z.number().int().nonnegative(),
	provider: z.enum(QUEUE_PROVIDER_IDS).optional(),
	uri: z.string().trim().max(2000).optional(),
});
export type UpdateNotificationQueueInput = z.input<
	typeof updateNotificationQueueSchema
>;

export const updateNotificationChannelSchema = z.object({
	revision: expectedRevision,
	enabled: z.boolean().optional(),
	strategy: z.enum(DELIVERY_STRATEGIES).optional(),
	from: patchText(200),
	allowPrivateNetworks: z.boolean().optional(),
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
