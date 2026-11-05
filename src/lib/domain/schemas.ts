import { z } from "zod";
import {
	INCIDENT_IMPACTS,
	INCIDENT_KINDS,
	INCIDENT_STATUSES,
	MAINTENANCE_STATUSES,
	ROLES,
	SERVICE_STATUSES,
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

const password = z.string().min(8).max(200);
const email = z
	.email()
	.max(254)
	.transform((value) => value.toLowerCase());

export const createMemberSchema = z.object({
	email,
	name: z.string().trim().min(1).max(120),
	role: roleSchema.optional(),
	password,
});
export type CreateMemberInput = z.input<typeof createMemberSchema>;

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

export const webhookSubscriberSchema = z.object({
	url: z.url({ protocol: /^https?$/ }).max(2000),
});

export const emailSubscriberSchema = z.object({ email });
