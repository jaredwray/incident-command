import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	eventStatusSchema,
	impactSchema,
	kindSchema,
	roleSchema,
	serviceStatusSchema,
} from "../domain/schemas";
import { hasRole } from "../domain/status";
import {
	type Actor,
	DELIVERY_STRATEGIES,
	type Incident,
	type Role,
	SUBSCRIBER_TYPES,
} from "../domain/types";
import { formatUptime } from "../domain/uptime";
import { isAppError } from "../errors";
import type { Services } from "../services";
import { draftPath } from "../services/drafts";
import { invitePath } from "../services/members";

export const MCP_SERVER_NAME = "incident-command";
export const MCP_SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `You are connected to an incident command service that powers a public status page.
- Use get_status first to understand the current state.
- Declare incidents with create_incident, keep customers informed with post_incident_update
  (statuses: investigating -> identified -> monitoring -> resolved), and close with resolve_incident.
- Affected services move to a status derived from the incident impact (minor=degraded_performance,
  major=partial_outage, critical=major_outage) unless serviceStatus is given; resolving restores them.
- Schedule planned work with schedule_maintenance (statuses: scheduled -> in_progress -> verifying -> completed).
- When a person must review a notification first, use draft_notification and give that person the reviewUrl.
  Nothing is published or sent until the person approves the draft. Check the result with get_notification_draft.
- Everything you post is public on the status page and may notify subscribers. Write for customers.`;

const id = z.string().min(1).describe("The record id");
const notify = z
	.boolean()
	.optional()
	.describe("Notify subscribers (default true)");
const isoDate = z
	.string()
	.describe("ISO 8601 timestamp with timezone, e.g. 2026-11-03T02:00:00Z");

type ToolHandler<A> = (args: A) => Promise<unknown>;

function result(data: unknown): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(data, null, 2),
			},
		],
	};
}

function failure(error: unknown): CallToolResult {
	if (!isAppError(error)) {
		console.error("[mcp] tool failed", error);
	}
	return {
		isError: true,
		content: [
			{
				type: "text",
				text: isAppError(error)
					? `${error.code}: ${error.message}`
					: "internal_error: Something went wrong",
			},
		],
	};
}

function incidentSummary(incident: Incident) {
	const latest = incident.updates.at(-1);
	return {
		id: incident.id,
		kind: incident.kind,
		title: incident.title,
		status: incident.status,
		impact: incident.impact,
		serviceIds: incident.serviceIds,
		startedAt: incident.startedAt,
		resolvedAt: incident.resolvedAt,
		scheduledStart: incident.scheduledStart,
		scheduledEnd: incident.scheduledEnd,
		latestUpdate: latest?.message,
		updatedAt: incident.updatedAt,
	};
}

/**
 * Builds an MCP server exposing tools for the given actor. Tools are only
 * registered when the actor's role allows them, so agents never see tools
 * they cannot call. `origin` is the request origin. Invite links use it when
 * no site URL is set.
 */
export function createMcpServer(
	services: Services,
	actor: Actor,
	origin: string,
): McpServer {
	const server = new McpServer(
		{ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
		{ instructions: INSTRUCTIONS },
	);

	/** A full portal URL. It uses the site URL, or the request origin when no site URL is set. */
	async function portalUrl(path: string): Promise<string> {
		const { siteUrl } = await services.settings.get();
		return `${siteUrl ?? origin}${path}`;
	}

	function tool<S extends z.ZodRawShape>(
		role: Role,
		name: string,
		config: {
			title: string;
			description: string;
			inputSchema: S;
			readOnly?: boolean;
		},
		handler: ToolHandler<z.infer<z.ZodObject<S>>>,
	): void {
		if (!hasRole(actor.role, role)) {
			return;
		}
		server.registerTool(
			name,
			{
				title: config.title,
				description: config.description,
				inputSchema: config.inputSchema,
				annotations: {
					readOnlyHint: config.readOnly ?? false,
					destructiveHint:
						name.startsWith("delete") ||
						name.startsWith("remove") ||
						name.startsWith("revoke"),
				},
			},
			(async (args: z.infer<z.ZodObject<S>>) => {
				try {
					return result(await handler(args));
				} catch (error) {
					return failure(error);
				}
			}) as never,
		);
	}

	// ---- read ---------------------------------------------------------------

	tool(
		"viewer",
		"whoami",
		{
			title: "Who am I",
			description:
				"Returns the agent identity and role used for this connection.",
			inputSchema: {},
			readOnly: true,
		},
		async () => actor,
	);

	tool(
		"viewer",
		"get_status",
		{
			title: "Get status",
			description:
				"Current overall status, every visible service with its status and uptime, open incidents and maintenance.",
			inputSchema: {},
			readOnly: true,
		},
		async () => {
			const summary = await services.status.summary();
			return {
				page: summary.settings.siteName,
				overall: summary.overall,
				services: summary.services.map((service) => ({
					id: service.id,
					name: service.name,
					group: service.group,
					status: service.status,
					uptime: formatUptime(service.uptime),
				})),
				activeIncidents: summary.activeIncidents.map(incidentSummary),
				activeMaintenance: summary.activeMaintenance.map(incidentSummary),
				upcomingMaintenance: summary.upcomingMaintenance.map(incidentSummary),
				uptimeWindowDays: summary.window.days,
			};
		},
	);

	tool(
		"viewer",
		"list_services",
		{
			title: "List services",
			description: "All services, including hidden ones, in display order.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.catalog.list(),
	);

	tool(
		"viewer",
		"list_incidents",
		{
			title: "List incidents",
			description: "Incidents and maintenance, newest first.",
			inputSchema: {
				kind: kindSchema.optional().describe("incident or maintenance"),
				open: z
					.boolean()
					.optional()
					.describe("true for open only, false for closed only"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Default 20"),
			},
			readOnly: true,
		},
		async ({ kind, open, limit }) =>
			(await services.incidents.list({ kind, open, limit: limit ?? 20 })).map(
				incidentSummary,
			),
	);

	tool(
		"viewer",
		"get_incident",
		{
			title: "Get incident",
			description: "An incident or maintenance with its full update timeline.",
			inputSchema: { id },
			readOnly: true,
		},
		async (args) => services.incidents.get(args.id),
	);

	// ---- services -----------------------------------------------------------

	tool(
		"editor",
		"create_service",
		{
			title: "Create service",
			description:
				"Adds a service (a system customers care about) to the status page.",
			inputSchema: {
				name: z.string(),
				description: z.string().optional(),
				group: z
					.string()
					.optional()
					.describe("Optional group name used to cluster services"),
				status: serviceStatusSchema.optional(),
				hidden: z.boolean().optional().describe("Hide from the public page"),
			},
		},
		async (args) => services.catalog.create(actor, args),
	);

	tool(
		"editor",
		"update_service",
		{
			title: "Update service",
			description:
				"Edits a service. Pass null or an empty string to clear description or group.",
			inputSchema: {
				id,
				name: z.string().optional(),
				description: z.string().nullable().optional(),
				group: z.string().nullable().optional(),
				status: serviceStatusSchema.optional(),
				hidden: z.boolean().optional(),
				order: z.number().int().optional(),
			},
		},
		async ({ id: serviceId, ...patch }) =>
			services.catalog.update(actor, serviceId, patch),
	);

	tool(
		"editor",
		"set_service_status",
		{
			title: "Set service status",
			description:
				"Changes a service's status without posting an incident. Status changes feed uptime history.",
			inputSchema: { id, status: serviceStatusSchema },
		},
		async (args) => services.catalog.setStatus(actor, args.id, args.status),
	);

	tool(
		"editor",
		"delete_service",
		{
			title: "Delete service",
			description: "Permanently deletes a service and its status history.",
			inputSchema: { id },
		},
		async (args) => {
			await services.catalog.delete(actor, args.id);
			return { deleted: args.id };
		},
	);

	// ---- incidents ------------------------------------------------------------

	tool(
		"editor",
		"create_incident",
		{
			title: "Create incident",
			description:
				"Declares a public incident with an initial update. Affected services change status based on impact.",
			inputSchema: {
				title: z.string().describe("Short customer-facing title"),
				message: z.string().describe("First public update"),
				impact: impactSchema
					.optional()
					.describe("none | minor | major | critical (default minor)"),
				serviceIds: z.array(z.string()).optional(),
				serviceStatus: serviceStatusSchema
					.optional()
					.describe("Override the status applied to affected services"),
				status: eventStatusSchema
					.optional()
					.describe(
						"investigating (default) | identified | monitoring | resolved",
					),
				notify,
			},
		},
		async (args) =>
			services.incidents.create(actor, { ...args, kind: "incident" }),
	);

	tool(
		"editor",
		"post_incident_update",
		{
			title: "Post incident update",
			description:
				"Adds a timeline update to an incident or maintenance, optionally changing its status.",
			inputSchema: {
				id,
				message: z.string(),
				status: eventStatusSchema.optional(),
				serviceStatus: serviceStatusSchema.optional(),
				notify,
			},
		},
		async ({ id: incidentId, ...input }) =>
			services.incidents.postUpdate(actor, incidentId, input),
	);

	tool(
		"editor",
		"resolve_incident",
		{
			title: "Resolve incident",
			description:
				"Resolves an incident (or completes maintenance) and restores affected services.",
			inputSchema: { id, message: z.string().optional() },
		},
		async (args) => services.incidents.resolve(actor, args.id, args.message),
	);

	tool(
		"editor",
		"edit_incident",
		{
			title: "Edit incident",
			description:
				"Edits incident metadata (title, impact, services, maintenance window) without posting an update.",
			inputSchema: {
				id,
				title: z.string().optional(),
				impact: impactSchema.optional(),
				serviceIds: z.array(z.string()).optional(),
				scheduledStart: isoDate.optional(),
				scheduledEnd: isoDate.optional(),
			},
		},
		async ({ id: incidentId, ...patch }) =>
			services.incidents.edit(actor, incidentId, patch),
	);

	tool(
		"editor",
		"delete_incident",
		{
			title: "Delete incident",
			description: "Permanently deletes an incident or maintenance.",
			inputSchema: { id },
		},
		async (args) => {
			await services.incidents.delete(actor, args.id);
			return { deleted: args.id };
		},
	);

	tool(
		"editor",
		"schedule_maintenance",
		{
			title: "Schedule maintenance",
			description:
				"Announces planned maintenance. Move it through in_progress and completed with post_incident_update.",
			inputSchema: {
				title: z.string(),
				message: z.string(),
				scheduledStart: isoDate,
				scheduledEnd: isoDate,
				serviceIds: z.array(z.string()).optional(),
				notify,
			},
		},
		async (args) =>
			services.incidents.create(actor, { ...args, kind: "maintenance" }),
	);

	// ---- notification drafts --------------------------------------------------

	tool(
		"editor",
		"draft_notification",
		{
			title: "Draft notification",
			description:
				"Saves a notification for a person to review. Nothing is published or sent until a person approves it. Give the reviewUrl to that person. With incidentId, the draft is an update to that incident. Without incidentId, the draft declares a new incident or maintenance. On approval, the update is published on the status page and subscribers are notified.",
			inputSchema: {
				incidentId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"The incident that gets the update. Omit to declare a new incident or maintenance.",
					),
				kind: kindSchema
					.optional()
					.describe("New events only: incident (default) or maintenance"),
				title: z
					.string()
					.optional()
					.describe("New events only: short customer-facing title"),
				message: z
					.string()
					.describe("The public message that subscribers receive"),
				status: eventStatusSchema
					.optional()
					.describe(
						"The status after approval. An update without a status keeps the current status.",
					),
				impact: impactSchema
					.optional()
					.describe(
						"New incidents only: none | minor | major | critical (default minor)",
					),
				serviceIds: z
					.array(z.string())
					.optional()
					.describe("New events only: affected services"),
				serviceStatus: serviceStatusSchema
					.optional()
					.describe("Override the status applied to affected services"),
				scheduledStart: isoDate
					.optional()
					.describe("New maintenance only: start of the window (ISO 8601)"),
				scheduledEnd: isoDate
					.optional()
					.describe("New maintenance only: end of the window (ISO 8601)"),
			},
		},
		async (args) => {
			const draft = await services.drafts.create(actor, args);
			return { reviewUrl: await portalUrl(draftPath(draft.id)), draft };
		},
	);

	tool(
		"viewer",
		"get_notification_draft",
		{
			title: "Get notification draft",
			description:
				"A notification draft and its review state: pending, approved or discarded. After approval, incidentId is the incident that has the published update.",
			inputSchema: { id },
			readOnly: true,
		},
		async (args) => {
			const draft = await services.drafts.get(args.id);
			return { reviewUrl: await portalUrl(draftPath(draft.id)), draft };
		},
	);

	// ---- admin ----------------------------------------------------------------

	tool(
		"admin",
		"list_members",
		{
			title: "List members",
			description: "People who can sign in to the manage portal.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.members.list(actor),
	);

	tool(
		"admin",
		"invite_member",
		{
			title: "Invite member",
			description:
				"Creates a one-time link that a person uses to create their own portal account. Give the inviteUrl to that person. The link expires after 7 days. A new invite for the same email replaces the old link.",
			inputSchema: {
				email: z.string(),
				role: roleSchema.optional(),
			},
		},
		async (args) => {
			const { token, invite } = await services.members.invite(actor, args);
			return { inviteUrl: await portalUrl(invitePath(token)), invite };
		},
	);

	tool(
		"admin",
		"list_invites",
		{
			title: "List invites",
			description: "Invites that nobody used yet, with their expiry times.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.members.listInvites(actor),
	);

	tool(
		"admin",
		"revoke_invite",
		{
			title: "Revoke invite",
			description: "Removes an invite. Its link stops working immediately.",
			inputSchema: { id },
		},
		async (args) => {
			await services.members.revokeInvite(actor, args.id);
			return { revoked: args.id };
		},
	);

	tool(
		"admin",
		"update_member",
		{
			title: "Update member",
			description: "Changes a member's name, email, role or password.",
			inputSchema: {
				id,
				name: z.string().optional(),
				email: z.string().optional(),
				role: roleSchema.optional(),
				password: z.string().optional(),
			},
		},
		async ({ id: memberId, ...patch }) =>
			services.members.update(actor, memberId, patch),
	);

	tool(
		"admin",
		"remove_member",
		{
			title: "Remove member",
			description: "Removes a portal member and signs them out.",
			inputSchema: { id },
		},
		async (args) => {
			await services.members.delete(actor, args.id);
			return { deleted: args.id };
		},
	);

	tool(
		"admin",
		"list_agents",
		{
			title: "List agents",
			description: "Agent tokens that can access this MCP server.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.agents.list(actor),
	);

	tool(
		"admin",
		"create_agent_token",
		{
			title: "Create agent token",
			description:
				"Creates a bearer token for another agent. The token is shown only once.",
			inputSchema: {
				name: z.string(),
				description: z.string().optional(),
				role: roleSchema
					.optional()
					.describe("viewer | editor (default) | admin"),
				expiresInDays: z.number().int().optional(),
			},
		},
		async (args) => services.agents.create(actor, args),
	);

	tool(
		"admin",
		"revoke_agent_token",
		{
			title: "Revoke agent token",
			description: "Immediately revokes an agent token.",
			inputSchema: { id },
		},
		async (args) => services.agents.revoke(actor, args.id),
	);

	tool(
		"admin",
		"get_settings",
		{
			title: "Get settings",
			description: "Status page settings and branding.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.settings.get(),
	);

	tool(
		"admin",
		"update_settings",
		{
			title: "Update settings",
			description:
				"Updates status page settings and branding. Pass null or an empty string to clear optional values.",
			inputSchema: {
				siteName: z.string().optional(),
				description: z.string().optional(),
				siteUrl: z.string().nullable().optional(),
				logoUrl: z.string().nullable().optional(),
				faviconUrl: z.string().nullable().optional(),
				supportUrl: z.string().nullable().optional(),
				theme: z
					.string()
					.optional()
					.describe(
						"Theme preset, e.g. default, midnight, ocean, sunset, mono",
					),
				brandColor: z
					.string()
					.nullable()
					.optional()
					.describe("Hex color such as #4f46e5"),
				customCss: z.string().nullable().optional(),
				allowSubscriptions: z.boolean().optional(),
				uptimeDays: z.number().int().optional(),
			},
		},
		async (args) => services.settings.update(actor, args),
	);

	tool(
		"admin",
		"get_notification_settings",
		{
			title: "Get notification settings",
			description:
				"The webhook, email and text messaging channels: on or off, the delivery strategy, the sender and the providers. Credentials are never returned.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.notificationSettings.list(actor),
	);

	tool(
		"admin",
		"update_notification_channel",
		{
			title: "Update notification channel",
			description:
				"Turns a channel on or off, sets its delivery strategy (active_passive or load_balanced) or sets its sender. Add providers and their credentials in the portal.",
			inputSchema: {
				channel: z.enum(SUBSCRIBER_TYPES),
				enabled: z.boolean().optional(),
				strategy: z.enum(DELIVERY_STRATEGIES).optional(),
				from: z
					.string()
					.nullable()
					.optional()
					.describe(
						"Email address or phone number. Pass null or an empty string to clear it.",
					),
			},
		},
		async ({ channel, ...input }) =>
			services.notificationSettings.updateChannel(actor, channel, input),
	);

	tool(
		"admin",
		"list_subscribers",
		{
			title: "List subscribers",
			description: "Webhook, email and text message subscribers.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.subscribers.list(actor),
	);

	tool(
		"admin",
		"add_subscriber",
		{
			title: "Add subscriber",
			description:
				"Adds a confirmed email subscriber, a webhook (Slack, Discord or any JSON endpoint) or a phone number for text messages.",
			inputSchema: {
				type: z.enum(SUBSCRIBER_TYPES),
				target: z
					.string()
					.describe("Email address, https URL or E.164 phone number"),
			},
		},
		async (args) => {
			switch (args.type) {
				case "email":
					return services.subscribers.addEmail(actor, { email: args.target });
				case "sms":
					return services.subscribers.addSms(actor, { phone: args.target });
				default:
					return services.subscribers.addWebhook(actor, { url: args.target });
			}
		},
	);

	tool(
		"admin",
		"remove_subscriber",
		{
			title: "Remove subscriber",
			description: "Removes a subscriber.",
			inputSchema: { id },
		},
		async (args) => {
			await services.subscribers.remove(actor, args.id);
			return { deleted: args.id };
		},
	);

	return server;
}
