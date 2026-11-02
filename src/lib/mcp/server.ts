import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	componentStatusSchema,
	eventStatusSchema,
	impactSchema,
	kindSchema,
	roleSchema,
} from "../domain/schemas";
import { hasRole } from "../domain/status";
import type { Actor, Incident, Role } from "../domain/types";
import { formatUptime } from "../domain/uptime";
import { isAppError } from "../errors";
import type { Services } from "../services";

export const MCP_SERVER_NAME = "incident-command";
export const MCP_SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `You are connected to an incident command service that powers a public status page.
- Use get_status first to understand the current state.
- Declare incidents with create_incident, keep customers informed with post_incident_update
  (statuses: investigating -> identified -> monitoring -> resolved), and close with resolve_incident.
- Affected components move to a status derived from the incident impact (minor=degraded_performance,
  major=partial_outage, critical=major_outage) unless componentStatus is given; resolving restores them.
- Schedule planned work with schedule_maintenance (statuses: scheduled -> in_progress -> verifying -> completed).
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
		componentIds: incident.componentIds,
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
 * they cannot call.
 */
export function createMcpServer(services: Services, actor: Actor): McpServer {
	const server = new McpServer(
		{ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
		{ instructions: INSTRUCTIONS },
	);

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
				"Current overall status, every visible component with its status and uptime, open incidents and maintenance.",
			inputSchema: {},
			readOnly: true,
		},
		async () => {
			const summary = await services.status.summary();
			return {
				page: summary.settings.siteName,
				overall: summary.overall,
				components: summary.components.map((component) => ({
					id: component.id,
					name: component.name,
					group: component.group,
					status: component.status,
					uptime: formatUptime(component.uptime),
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
		"list_components",
		{
			title: "List components",
			description: "All components, including hidden ones, in display order.",
			inputSchema: {},
			readOnly: true,
		},
		async () => services.components.list(),
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

	// ---- components -----------------------------------------------------------

	tool(
		"editor",
		"create_component",
		{
			title: "Create component",
			description:
				"Adds a component (a service or system customers care about) to the status page.",
			inputSchema: {
				name: z.string(),
				description: z.string().optional(),
				group: z
					.string()
					.optional()
					.describe("Optional group name used to cluster components"),
				status: componentStatusSchema.optional(),
				hidden: z.boolean().optional().describe("Hide from the public page"),
			},
		},
		async (args) => services.components.create(actor, args),
	);

	tool(
		"editor",
		"update_component",
		{
			title: "Update component",
			description:
				"Edits a component. Pass null or an empty string to clear description or group.",
			inputSchema: {
				id,
				name: z.string().optional(),
				description: z.string().nullable().optional(),
				group: z.string().nullable().optional(),
				status: componentStatusSchema.optional(),
				hidden: z.boolean().optional(),
				order: z.number().int().optional(),
			},
		},
		async ({ id: componentId, ...patch }) =>
			services.components.update(actor, componentId, patch),
	);

	tool(
		"editor",
		"set_component_status",
		{
			title: "Set component status",
			description:
				"Changes a component's status without posting an incident. Status changes feed uptime history.",
			inputSchema: { id, status: componentStatusSchema },
		},
		async (args) => services.components.setStatus(actor, args.id, args.status),
	);

	tool(
		"editor",
		"delete_component",
		{
			title: "Delete component",
			description: "Permanently deletes a component and its status history.",
			inputSchema: { id },
		},
		async (args) => {
			await services.components.delete(actor, args.id);
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
				"Declares a public incident with an initial update. Affected components change status based on impact.",
			inputSchema: {
				title: z.string().describe("Short customer-facing title"),
				message: z.string().describe("First public update"),
				impact: impactSchema
					.optional()
					.describe("none | minor | major | critical (default minor)"),
				componentIds: z.array(z.string()).optional(),
				componentStatus: componentStatusSchema
					.optional()
					.describe("Override the status applied to affected components"),
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
				componentStatus: componentStatusSchema.optional(),
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
				"Resolves an incident (or completes maintenance) and restores affected components.",
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
				"Edits incident metadata (title, impact, components, maintenance window) without posting an update.",
			inputSchema: {
				id,
				title: z.string().optional(),
				impact: impactSchema.optional(),
				componentIds: z.array(z.string()).optional(),
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
				componentIds: z.array(z.string()).optional(),
				notify,
			},
		},
		async (args) =>
			services.incidents.create(actor, { ...args, kind: "maintenance" }),
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
		"create_member",
		{
			title: "Create member",
			description:
				"Adds a portal member. Share the initial password with them securely.",
			inputSchema: {
				email: z.string(),
				name: z.string(),
				role: roleSchema.optional(),
				password: z.string(),
			},
		},
		async (args) => services.members.create(actor, args),
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
		"list_subscribers",
		{
			title: "List subscribers",
			description: "Email and webhook subscribers.",
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
				"Adds a confirmed email subscriber or a webhook (Slack, Discord or any JSON endpoint).",
			inputSchema: {
				type: z.enum(["email", "webhook"]),
				target: z.string().describe("Email address or https URL"),
			},
		},
		async (args) =>
			args.type === "email"
				? services.subscribers.addEmail(actor, { email: args.target })
				: services.subscribers.addWebhook(actor, { url: args.target }),
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
