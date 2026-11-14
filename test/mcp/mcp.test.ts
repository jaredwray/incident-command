import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Role } from "@/lib/domain/types";
import { bearerToken, handleMcpRequest } from "@/lib/mcp/handler";
import { ADMIN, createTestContext, type TestContext } from "../helpers";

type ToolResult = {
	isError?: boolean;
	content: { type: string; text: string }[];
};

async function connect(t: TestContext, token: string) {
	const client = new Client({ name: "test-agent", version: "1.0.0" });
	const transport = new StreamableHTTPClientTransport(
		new URL("http://localhost/api/mcp"),
		{
			fetch: (url, init) =>
				handleMcpRequest(new Request(url, init), t.services),
			requestInit: { headers: { authorization: `Bearer ${token}` } },
		},
	);
	await client.connect(transport);
	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const result = (await client.callTool({
			name,
			arguments: args,
		})) as ToolResult;
		const text = result.content[0]?.text ?? "";
		return {
			isError: result.isError ?? false,
			text,
			data: result.isError ? undefined : JSON.parse(text),
		};
	};
	return { client, call };
}

async function tokenFor(t: TestContext, role: Role) {
	return (await t.services.agents.create(ADMIN, { name: `${role} bot`, role }))
		.token;
}

describe("MCP handler", () => {
	let t: TestContext;
	beforeEach(() => {
		t = createTestContext();
	});

	it("parses bearer tokens", () => {
		expect(bearerToken("Bearer abc")).toBe("abc");
		expect(bearerToken("bearer   abc ")).toBe("abc");
		expect(bearerToken("Basic abc")).toBeUndefined();
		expect(bearerToken(null)).toBeUndefined();
	});

	it("rejects non-POST requests", async () => {
		const response = await handleMcpRequest(
			new Request("http://localhost/api/mcp"),
			t.services,
		);
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
	});

	it("rejects missing and invalid tokens", async () => {
		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		});
		const anonymous = await handleMcpRequest(
			new Request("http://localhost/api/mcp", { method: "POST", body }),
			t.services,
		);
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get("www-authenticate")).toContain("Bearer");
		expect(await anonymous.json()).toMatchObject({
			error: { message: "Missing or invalid agent token" },
		});
		const bad = await handleMcpRequest(
			new Request("http://localhost/api/mcp", {
				method: "POST",
				body,
				headers: { authorization: "Bearer icmd_nope" },
			}),
			t.services,
		);
		expect(bad.status).toBe(401);
	});

	it("only exposes tools allowed for the agent's role", async () => {
		const names = async (role: Role) => {
			const { client } = await connect(t, await tokenFor(t, role));
			const { tools } = await client.listTools();
			await client.close();
			return tools.map((tool) => tool.name);
		};
		const viewer = await names("viewer");
		expect(viewer).toEqual([
			"whoami",
			"get_status",
			"list_services",
			"list_incidents",
			"get_incident",
			"get_notification_draft",
		]);
		const editor = await names("editor");
		expect(editor).toContain("create_incident");
		expect(editor).toContain("draft_notification");
		expect(editor).not.toContain("create_agent_token");
		const admin = await names("admin");
		expect(admin).toContain("create_agent_token");
		expect(admin).toContain("get_notification_settings");
		expect(admin).toContain("update_notification_channel");
		expect(admin).toHaveLength(33);
	});

	it("lets an editor agent run an incident end to end", async () => {
		const { client, call } = await connect(t, await tokenFor(t, "editor"));
		expect(client.getInstructions()).toContain("incident command");
		expect((await call("whoami")).data).toMatchObject({
			type: "agent",
			role: "editor",
		});

		const api = (await call("create_service", { name: "API", group: "Core" }))
			.data;
		const web = (await call("create_service", { name: "Web" })).data;
		expect(
			(
				await call("update_service", {
					id: web.id,
					description: "Marketing site",
					order: 5,
				})
			).data,
		).toMatchObject({
			description: "Marketing site",
			order: 5,
		});
		expect(
			(
				await call("set_service_status", {
					id: web.id,
					status: "degraded_performance",
				})
			).data.status,
		).toBe("degraded_performance");
		expect((await call("list_services")).data).toHaveLength(2);

		const incident = (
			await call("create_incident", {
				title: "API errors",
				message: "Investigating",
				impact: "critical",
				serviceIds: [api.id],
			})
		).data;
		expect(incident).toMatchObject({
			kind: "incident",
			status: "investigating",
			createdBy: { type: "agent", name: "editor bot" },
		});

		const status = (await call("get_status")).data;
		expect(status).toMatchObject({
			overall: "major_outage",
			uptimeWindowDays: 90,
		});
		expect(status.services[0]).toMatchObject({
			name: "API",
			status: "major_outage",
			uptime: "No data",
		});
		expect(status.activeIncidents[0]).toMatchObject({
			id: incident.id,
			latestUpdate: "Investigating",
		});

		await call("post_incident_update", {
			id: incident.id,
			status: "identified",
			message: "Bad deploy",
		});
		await call("edit_incident", {
			id: incident.id,
			title: "API errors after deploy",
		});
		const resolved = (
			await call("resolve_incident", {
				id: incident.id,
				message: "Rolled back",
			})
		).data;
		expect(resolved).toMatchObject({
			status: "resolved",
			title: "API errors after deploy",
		});
		expect(resolved.updates).toHaveLength(3);
		expect(
			(await call("get_incident", { id: incident.id })).data.updates,
		).toHaveLength(3);

		const maintenance = (
			await call("schedule_maintenance", {
				title: "DB upgrade",
				message: "Upgrading",
				scheduledStart: "2026-11-03T02:00:00Z",
				scheduledEnd: "2026-11-03T03:00:00Z",
				serviceIds: [api.id],
			})
		).data;
		expect(maintenance).toMatchObject({
			kind: "maintenance",
			status: "scheduled",
		});

		const listed = (await call("list_incidents", { open: false })).data;
		expect(listed.map((i: { id: string }) => i.id)).toEqual([incident.id]);
		expect(
			(await call("list_incidents", { kind: "maintenance" })).data,
		).toHaveLength(1);
		expect((await call("list_incidents")).data).toHaveLength(2);

		expect(
			(await call("delete_incident", { id: maintenance.id })).data,
		).toEqual({ deleted: maintenance.id });
		expect((await call("delete_service", { id: web.id })).data).toEqual({
			deleted: web.id,
		});
		await client.close();
	});

	it("lets an agent draft a notification that a person reviews", async () => {
		const { call } = await connect(t, await tokenFor(t, "editor"));
		const api = await t.services.catalog.create(ADMIN, { name: "API" });
		const drafted = (
			await call("draft_notification", {
				title: "API errors",
				message: "We are looking into errors.",
				impact: "major",
				serviceIds: [api.id],
			})
		).data;
		expect(drafted.reviewUrl).toBe(
			`http://localhost/manage/drafts/${drafted.draft.id}`,
		);
		expect(drafted.draft).toMatchObject({
			action: "create",
			state: "pending",
			createdBy: { type: "agent", name: "editor bot" },
		});
		expect((await call("list_incidents")).data).toEqual([]);

		const rejected = await call("draft_notification", {
			incidentId: "inc_missing",
			message: "x",
		});
		expect(rejected).toMatchObject({
			isError: true,
			text: 'not_found: Incident "inc_missing" was not found',
		});

		const { incident } = await t.services.drafts.approve(
			ADMIN,
			drafted.draft.id,
			drafted.draft.content,
		);
		const viewer = await connect(t, await tokenFor(t, "viewer"));
		const checked = (
			await viewer.call("get_notification_draft", { id: drafted.draft.id })
		).data;
		expect(checked).toMatchObject({
			reviewUrl: drafted.reviewUrl,
			draft: { state: "approved", incidentId: incident.id },
		});

		const update = (
			await call("draft_notification", {
				incidentId: incident.id,
				message: "A fix is ready.",
				status: "monitoring",
			})
		).data;
		expect(update.draft).toMatchObject({
			action: "update",
			kind: "incident",
			incidentId: incident.id,
		});
	});

	it("returns tool errors for expected failures", async () => {
		const { call } = await connect(t, await tokenFor(t, "editor"));
		const missing = await call("get_incident", { id: "inc_missing" });
		expect(missing).toMatchObject({
			isError: true,
			text: 'not_found: Incident "inc_missing" was not found',
		});
		const invalid = await call("create_incident", { title: "", message: "x" });
		expect(invalid.isError).toBe(true);
		expect(invalid.text).toMatch(/^bad_request: title/);
	});

	it("hides internal errors", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(t.services.status, "summary").mockRejectedValueOnce(
			new Error("secret db details"),
		);
		const { call } = await connect(t, await tokenFor(t, "viewer"));
		const result = await call("get_status");
		expect(result).toMatchObject({
			isError: true,
			text: "internal_error: Something went wrong",
		});
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("lets an admin agent manage members, agents, settings and subscribers", async () => {
		const { call } = await connect(t, await tokenFor(t, "admin"));
		const invited = (await call("invite_member", { email: "new@acme.dev" }))
			.data;
		expect(invited.invite).toMatchObject({
			email: "new@acme.dev",
			role: "editor",
			invitedBy: { type: "agent", name: "admin bot" },
		});
		expect(invited.inviteUrl).toMatch(
			/^http:\/\/localhost\/manage\/invite\?token=/,
		);
		expect((await call("list_invites")).data).toEqual([invited.invite]);
		const member = await t.services.members.acceptInvite(
			new URL(invited.inviteUrl).searchParams.get("token") as string,
			{ name: "New", password: "password123" },
		);
		expect(member).toMatchObject({ email: "new@acme.dev", role: "editor" });
		const spare = (await call("invite_member", { email: "spare@acme.dev" }))
			.data;
		expect((await call("revoke_invite", { id: spare.invite.id })).data).toEqual(
			{ revoked: spare.invite.id },
		);
		expect((await call("list_invites")).data).toEqual([]);
		expect(
			(await call("update_member", { id: member.id, role: "viewer" })).data
				.role,
		).toBe("viewer");
		expect((await call("list_members")).data).toHaveLength(1);
		expect((await call("remove_member", { id: member.id })).data).toEqual({
			deleted: member.id,
		});

		const created = (
			await call("create_agent_token", { name: "Helper", role: "viewer" })
		).data;
		expect(created.token).toMatch(/^icmd_/);
		expect((await call("list_agents")).data).toHaveLength(2);
		expect(
			(await call("revoke_agent_token", { id: created.agent.id })).data
				.revokedAt,
		).toBeDefined();

		expect(
			(
				await call("update_settings", {
					siteName: "Acme Status",
					brandColor: "#123456",
				})
			).data,
		).toMatchObject({
			siteName: "Acme Status",
			brandColor: "#123456",
		});
		expect((await call("get_settings")).data.siteName).toBe("Acme Status");
		await call("update_settings", { siteUrl: "https://status.acme.dev" });
		expect(
			(await call("invite_member", { email: "later@acme.dev" })).data.inviteUrl,
		).toMatch(/^https:\/\/status\.acme\.dev\/manage\/invite\?token=/);

		const hook = (
			await call("add_subscriber", {
				type: "webhook",
				target: "https://hooks.example.com/a",
			})
		).data;
		const email = (
			await call("add_subscriber", { type: "email", target: "ops@acme.dev" })
		).data;
		const phone = (
			await call("add_subscriber", { type: "sms", target: "+15551234567" })
		).data;
		expect([hook.type, email.type, phone.type]).toEqual([
			"webhook",
			"email",
			"sms",
		]);
		expect((await call("list_subscribers")).data).toHaveLength(3);

		const channel = (
			await call("update_notification_channel", {
				channel: "sms",
				strategy: "load_balanced",
				from: "ACME",
			})
		).data;
		expect(channel).toMatchObject({
			id: "sms",
			strategy: "load_balanced",
			from: "ACME",
		});
		const channels = (await call("get_notification_settings")).data;
		expect(channels.map((item: { id: string }) => item.id)).toEqual([
			"webhook",
			"email",
			"sms",
		]);
		expect((await call("remove_subscriber", { id: hook.id })).data).toEqual({
			deleted: hook.id,
		});
	});
});
