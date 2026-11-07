import {
	acceptInviteAction,
	addSubscriberAction,
	approveDraftAction,
	changePasswordAction,
	createAgentAction,
	createIncidentAction,
	createServiceAction,
	deleteAgentAction,
	deleteIncidentAction,
	deleteMemberAction,
	deleteServiceAction,
	deleteSubscriberAction,
	discardDraftAction,
	editIncidentAction,
	inviteMemberAction,
	loginAction,
	logoutAction,
	postIncidentUpdateAction,
	renewInviteLinkAction,
	revokeAgentAction,
	revokeInviteAction,
	saveDraftAction,
	setServiceStatusAction,
	setupAction,
	updateMemberAction,
	updateServiceAction,
	updateSettingsAction,
} from "@/app/manage/actions";
import { subscribeAction, unsubscribeAction } from "@/app/subscribe/actions";
import { SESSION_COOKIE } from "@/lib/auth";
import type { Actor } from "@/lib/domain/types";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import { form, redirectOf, setupApp, signIn } from "./app";
import { cookieJar } from "./next-state";

describe("session actions", () => {
	it("sets up the first admin and signs them in", async () => {
		const { services } = await setupApp();
		const url = await redirectOf(
			setupAction(
				form({ name: "Ada", email: "ada@acme.dev", password: "password123" }),
			),
		);
		expect(url).toBe("/manage?notice=Welcome! Your admin account is ready.");
		expect(cookieJar.get(SESSION_COOKIE)?.value).toBeTruthy();
		expect(cookieJar.get(SESSION_COOKIE)).toMatchObject({
			httpOnly: true,
			sameSite: "lax",
			path: "/",
		});
		expect(await services.members.count()).toBe(1);
		expect(
			await redirectOf(
				setupAction(
					form({ name: "B", email: "b@acme.dev", password: "password123" }),
				),
			),
		).toBe("/manage/setup?error=Setup has already been completed");
	});

	it("checks the setup token", async () => {
		await setupApp({ SETUP_TOKEN: "s3t" });
		expect(
			await redirectOf(
				setupAction(
					form({
						name: "A",
						email: "a@acme.dev",
						password: "password123",
						token: "nope",
					}),
				),
			),
		).toBe("/manage/setup?error=Invalid setup token");
	});

	it("logs in and out", async () => {
		const { services } = await setupApp();
		await services.members.setup({
			name: "Ada",
			email: "ada@acme.dev",
			password: "password123",
		});
		expect(
			await redirectOf(
				loginAction(form({ email: "ada@acme.dev", password: "wrong" })),
			),
		).toBe("/manage/login?error=Invalid email or password");
		expect(
			await redirectOf(
				loginAction(form({ email: "ADA@acme.dev", password: "password123" })),
			),
		).toBe("/manage");
		const token = cookieJar.get(SESSION_COOKIE)?.value;
		await expect(services.sessions.resolve(token)).resolves.toBeDefined();
		expect(await redirectOf(logoutAction())).toBe("/manage/login");
		expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
		await expect(services.sessions.resolve(token)).resolves.toBeUndefined();
	});

	it("returns to the portal path of the sign-in link", async () => {
		const { services } = await setupApp();
		await services.members.setup({
			name: "Ada",
			email: "ada@acme.dev",
			password: "password123",
		});
		const next = "/manage/drafts/drf_1";
		expect(
			await redirectOf(
				loginAction(form({ email: "ada@acme.dev", password: "wrong", next })),
			),
		).toBe(
			"/manage/login?next=/manage/drafts/drf_1&error=Invalid email or password",
		);
		expect(
			await redirectOf(
				loginAction(
					form({ email: "ada@acme.dev", password: "password123", next }),
				),
			),
		).toBe(next);
		for (const unsafe of [
			"https://evil.example",
			"//evil.example",
			"/x",
			"/manage/drafts\r\nSet-Cookie: a=b",
		]) {
			expect(
				await redirectOf(
					loginAction(
						form({
							email: "ada@acme.dev",
							password: "password123",
							next: unsafe,
						}),
					),
				),
			).toBe("/manage");
		}
	});

	it("handles missing form fields", async () => {
		await setupApp();
		expect(await redirectOf(loginAction(new FormData()))).toBe(
			"/manage/login?error=Invalid email or password",
		);
	});

	it("changes the signed-in member's password", async () => {
		const { app } = await setupApp();
		const { member } = await signIn(app, "viewer");
		expect(
			await redirectOf(
				changePasswordAction(
					form({ currentPassword: "nope", newPassword: "password456" }),
				),
			),
		).toBe("/manage/account?error=Current password is incorrect");
		expect(
			await redirectOf(
				changePasswordAction(
					form({ currentPassword: "password123", newPassword: "password456" }),
				),
			),
		).toBe("/manage/account?notice=Password updated");
		await expect(
			app.services.members.authenticate({
				email: member.email,
				password: "password456",
			}),
		).resolves.toBeDefined();
	});

	it("requires a session and the right role", async () => {
		const { app } = await setupApp();
		expect(await redirectOf(createServiceAction(form({ name: "API" })))).toBe(
			"/manage/login",
		);
		await signIn(app, "viewer");
		expect(await redirectOf(createServiceAction(form({ name: "API" })))).toBe(
			"/manage?error=That page requires the editor role",
		);
	});

	it("rethrows unexpected errors", async () => {
		const { app } = await setupApp();
		await signIn(app, "editor");
		vi.spyOn(app.services.catalog, "create").mockRejectedValueOnce(
			new Error("boom"),
		);
		await expect(createServiceAction(form({ name: "API" }))).rejects.toThrow(
			"boom",
		);
	});
});

describe("incident actions", () => {
	it("declares, updates, edits and deletes incidents", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });

		const created = await redirectOf(
			createIncidentAction(
				form({
					title: "API down",
					message: "Investigating",
					impact: "critical",
					serviceIds: [api.id, ""],
					notify: "on",
					status: "",
				}),
			),
		);
		const [incident] = await services.incidents.list();
		expect(created).toBe(
			`/manage/incidents/${incident?.id}?notice=Incident declared`,
		);
		expect(incident).toMatchObject({
			kind: "incident",
			impact: "critical",
			serviceIds: [api.id],
		});
		expect((await services.catalog.get(api.id)).status).toBe("major_outage");

		expect(
			await redirectOf(
				postIncidentUpdateAction(
					form({
						id: incident?.id ?? "",
						status: "resolved",
						message: "Fixed",
						serviceStatus: "",
					}),
				),
			),
		).toBe(`/manage/incidents/${incident?.id}?notice=Update posted`);
		expect((await services.incidents.get(incident?.id ?? "")).status).toBe(
			"resolved",
		);

		expect(
			await redirectOf(
				editIncidentAction(
					form({
						id: incident?.id ?? "",
						title: "API outage",
						impact: "major",
					}),
				),
			),
		).toBe(`/manage/incidents/${incident?.id}?notice=Incident saved`);
		expect((await services.incidents.get(incident?.id ?? "")).title).toBe(
			"API outage",
		);

		expect(
			await redirectOf(deleteIncidentAction(form({ id: incident?.id ?? "" }))),
		).toBe("/manage/incidents?notice=Incident deleted");
		expect(
			await redirectOf(deleteIncidentAction(form({ id: incident?.id ?? "" }))),
		).toMatch(/^\/manage\/incidents\?error=Incident/);
	});

	it("schedules maintenance from datetime-local inputs", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		const url = await redirectOf(
			createIncidentAction(
				form({
					kind: "maintenance",
					title: "Upgrade",
					message: "Planned",
					scheduledStart: "2026-11-05T02:00",
					scheduledEnd: "2026-11-05T03:00",
				}),
			),
		);
		expect(url).toMatch(/notice=Maintenance scheduled$/);
		const [maintenance] = await services.incidents.list();
		expect(maintenance).toMatchObject({
			kind: "maintenance",
			scheduledStart: "2026-11-05T02:00:00.000Z",
			scheduledEnd: "2026-11-05T03:00:00.000Z",
		});
	});

	it("redirects back with validation errors", async () => {
		const { app } = await setupApp();
		await signIn(app, "editor");
		expect(
			await redirectOf(
				createIncidentAction(
					form({ kind: "maintenance", title: "x", message: "y" }),
				),
			),
		).toBe(
			"/manage/incidents/new?kind=maintenance&error=Maintenance requires scheduledStart and scheduledEnd",
		);
		expect(
			await redirectOf(createIncidentAction(form({ title: "", message: "y" }))),
		).toMatch(/^\/manage\/incidents\/new\?kind=incident&error=title/);
		expect(
			await redirectOf(
				postIncidentUpdateAction(form({ id: "nope", message: "x" })),
			),
		).toMatch(/^\/manage\/incidents\/nope\?error=/);
		expect(
			await redirectOf(editIncidentAction(form({ id: "nope", title: "x" }))),
		).toMatch(/^\/manage\/incidents\/nope\?error=/);
	});
});

describe("notification draft actions", () => {
	const AGENT: Actor = {
		type: "agent",
		id: "agt_bot",
		name: "Ops bot",
		role: "editor",
	};

	it("saves, approves and discards drafts", async () => {
		const { app, services, notifier } = await setupApp();
		await signIn(app, "editor");
		await services.subscribers.addWebhook(SYSTEM_ACTOR, {
			url: "https://hooks.example.com/x",
		});
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const draft = await services.drafts.create(AGENT, {
			title: "API errors",
			message: "x",
		});
		const fields = {
			id: draft.id,
			title: "Elevated API errors",
			status: "identified",
			impact: "major",
			message: "We found the cause.",
			serviceIds: [api.id, ""],
			serviceStatus: "",
		};
		expect(await redirectOf(saveDraftAction(form(fields)))).toBe(
			`/manage/drafts/${draft.id}?notice=Draft saved`,
		);
		expect((await services.drafts.get(draft.id)).content).toMatchObject({
			title: "Elevated API errors",
			status: "identified",
			impact: "major",
			message: "We found the cause.",
			serviceIds: [api.id],
		});
		expect(notifier.incidents).toHaveLength(0);

		const approved = await redirectOf(approveDraftAction(form(fields)));
		const [incident] = await services.incidents.list();
		expect(approved).toBe(
			`/manage/incidents/${incident?.id}?notice=Draft approved. The update is published and subscribers are notified.`,
		);
		expect(incident).toMatchObject({
			title: "Elevated API errors",
			status: "identified",
			serviceIds: [api.id],
		});
		expect(notifier.incidents).toHaveLength(1);
		expect(await redirectOf(approveDraftAction(form(fields)))).toBe(
			`/manage/drafts/${draft.id}?error=This draft was already approved`,
		);

		const update = await services.drafts.create(AGENT, {
			incidentId: incident?.id ?? "",
			message: "y",
		});
		// The form of an update has no title, impact, services or window.
		expect(
			await redirectOf(
				saveDraftAction(
					form({ id: update.id, status: "monitoring", message: "Edited" }),
				),
			),
		).toBe(`/manage/drafts/${update.id}?notice=Draft saved`);
		expect((await services.drafts.get(update.id)).content).toMatchObject({
			status: "monitoring",
			message: "Edited",
		});
		expect(await redirectOf(discardDraftAction(form({ id: update.id })))).toBe(
			"/manage/drafts?notice=Draft discarded",
		);
		expect(await redirectOf(discardDraftAction(form({ id: update.id })))).toBe(
			`/manage/drafts/${update.id}?error=This draft was already discarded`,
		);
	});

	it("saves the window of maintenance from datetime-local inputs", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const draft = await services.drafts.create(AGENT, {
			kind: "maintenance",
			title: "Upgrade",
			message: "x",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		await redirectOf(
			saveDraftAction(
				form({
					id: draft.id,
					title: "Upgrade",
					message: "x",
					scheduledStart: "2026-11-05T02:00",
					scheduledEnd: "2026-11-05T03:00",
				}),
			),
		);
		expect((await services.drafts.get(draft.id)).content).toMatchObject({
			scheduledStart: "2026-11-05T02:00:00.000Z",
			scheduledEnd: "2026-11-05T03:00:00.000Z",
		});
	});

	it("redirects back with errors and requires the editor role", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const draft = await services.drafts.create(AGENT, {
			title: "API errors",
			message: "x",
		});
		expect(
			await redirectOf(
				approveDraftAction(form({ id: draft.id, title: "x", message: "" })),
			),
		).toMatch(new RegExp(`^/manage/drafts/${draft.id}\\?error=message`));
		expect((await services.drafts.get(draft.id)).state).toBe("pending");
		await signIn(app, "viewer");
		expect(await redirectOf(discardDraftAction(form({ id: draft.id })))).toBe(
			"/manage?error=That page requires the editor role",
		);
	});
});

describe("service actions", () => {
	it("creates, edits, sets status and deletes services", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		expect(
			await redirectOf(
				createServiceAction(
					form({ name: "API", group: "Core", description: "", hidden: "on" }),
				),
			),
		).toBe("/manage/services?notice=Service created");
		const [api] = await services.catalog.list();
		expect(api).toMatchObject({ name: "API", group: "Core", hidden: true });

		expect(
			await redirectOf(
				updateServiceAction(
					form({
						id: api?.id ?? "",
						name: "REST API",
						group: "",
						description: "Public",
						order: "4",
					}),
				),
			),
		).toBe("/manage/services?notice=Service saved");
		const updated = await services.catalog.get(api?.id ?? "");
		expect(updated).toMatchObject({
			name: "REST API",
			description: "Public",
			order: 4,
			hidden: false,
		});
		expect(updated.group).toBeUndefined();

		expect(
			await redirectOf(
				updateServiceAction(
					form({ id: api?.id ?? "", name: "REST API", order: "" }),
				),
			),
		).toBe("/manage/services?notice=Service saved");

		expect(
			await redirectOf(
				setServiceStatusAction(
					form({ id: api?.id ?? "", status: "partial_outage" }),
				),
			),
		).toBe("/manage/services?notice=Status updated");
		expect((await services.catalog.get(api?.id ?? "")).status).toBe(
			"partial_outage",
		);
		expect(
			await redirectOf(
				setServiceStatusAction(form({ id: api?.id ?? "", status: "bogus" })),
			),
		).toMatch(/error=/);

		expect(
			await redirectOf(deleteServiceAction(form({ id: api?.id ?? "" }))),
		).toBe("/manage/services?notice=Service deleted");
		expect(
			await redirectOf(deleteServiceAction(form({ id: api?.id ?? "" }))),
		).toMatch(/error=Service/);
	});
});

describe("member actions", () => {
	it("creates invite links through useActionState and revokes them", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		const state = await inviteMemberAction(
			{},
			form({ email: "Ed@Acme.dev", role: "viewer" }),
		);
		expect(state.email).toBe("ed@acme.dev");
		expect(state.url).toMatch(
			/^http:\/\/localhost:3000\/manage\/invite\?token=[\w-]{43}$/,
		);
		const token = new URL(state.url as string).searchParams.get("token");
		await expect(
			services.members.findInvite(token as string),
		).resolves.toMatchObject({ email: "ed@acme.dev", role: "viewer" });
		expect(
			await inviteMemberAction({}, form({ email: "nope", role: "editor" })),
		).toMatchObject({ error: expect.stringMatching(/^email/) });

		const [invite] = await services.members.listInvites(actor);
		const renewed = await renewInviteLinkAction(invite?.id ?? "");
		expect(renewed).toEqual({
			url: expect.stringMatching(
				/^http:\/\/localhost:3000\/manage\/invite\?token=[\w-]{43}$/,
			),
		});
		const renewedUrl = "url" in renewed ? renewed.url : "";
		await expect(
			services.members.findInvite(
				new URL(renewedUrl).searchParams.get("token") as string,
			),
		).resolves.toMatchObject({ email: "ed@acme.dev" });

		expect(
			await redirectOf(revokeInviteAction(form({ id: invite?.id ?? "" }))),
		).toBe("/manage/members?notice=Invite revoked");
		expect(
			await redirectOf(revokeInviteAction(form({ id: invite?.id ?? "" }))),
		).toMatch(/error=Invite/);
		expect(await renewInviteLinkAction(invite?.id ?? "")).toEqual({
			error: expect.stringMatching(/^Invite/),
		});
	});

	it("uses the configured site url for invite links", async () => {
		const { app } = await setupApp({ SITE_URL: "https://status.example.com" });
		await signIn(app, "admin");
		const state = await inviteMemberAction(
			{},
			form({ email: "ed@acme.dev", role: "editor" }),
		);
		expect(state.url).toMatch(
			/^https:\/\/status\.example\.com\/manage\/invite\?token=/,
		);
	});

	it("creates the account from an invite and signs the member in", async () => {
		const { services } = await setupApp();
		const { token } = await services.members.invite(SYSTEM_ACTOR, {
			email: "ed@acme.dev",
			role: "editor",
		});
		expect(
			await redirectOf(
				acceptInviteAction(form({ token, name: "Ed", password: "short" })),
			),
		).toBe(
			`/manage/invite?token=${token}&error=password: Too small: expected string to have >=8 characters`,
		);
		expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
		expect(
			await redirectOf(
				acceptInviteAction(
					form({ token, name: "Ed", password: "password123" }),
				),
			),
		).toBe("/manage?notice=Welcome! Your account is ready.");
		const session = await services.sessions.resolve(
			cookieJar.get(SESSION_COOKIE)?.value,
		);
		expect(session?.member).toMatchObject({
			email: "ed@acme.dev",
			name: "Ed",
			role: "editor",
		});
		expect(
			await redirectOf(
				acceptInviteAction(
					form({ token, name: "Ed", password: "password123" }),
				),
			),
		).toBe(
			`/manage/invite?token=${token}&error=This invite link is not valid. Ask an admin for a new invite.`,
		);
	});

	it("updates and removes members", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		const { token } = await services.members.invite(actor, {
			email: "ed@acme.dev",
		});
		const ed = await services.members.acceptInvite(token, {
			name: "Ed",
			password: "password123",
		});
		expect(
			await redirectOf(
				updateMemberAction(form({ id: ed.id, role: "viewer", password: "" })),
			),
		).toBe("/manage/members?notice=Member updated");
		expect((await services.members.get(ed.id))?.role).toBe("viewer");
		expect(
			await redirectOf(
				updateMemberAction(form({ id: ed.id, password: "newpassword1" })),
			),
		).toBe("/manage/members?notice=Member updated");
		expect(await redirectOf(deleteMemberAction(form({ id: ed.id })))).toBe(
			"/manage/members?notice=Member removed",
		);
		expect(await redirectOf(updateMemberAction(form({ id: "nope" })))).toMatch(
			/error=Member/,
		);
		expect(await redirectOf(deleteMemberAction(form({ id: actor.id })))).toBe(
			"/manage/members?error=You cannot remove the last admin",
		);
	});
});

describe("agent actions", () => {
	it("creates tokens through useActionState and manages them", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		const state = await createAgentAction(
			{},
			form({
				name: "Bot",
				role: "editor",
				description: "",
				expiresInDays: "30",
			}),
		);
		expect(state.token).toMatch(/^icmd_/);
		expect(state.name).toBe("Bot");
		const [agent] = await services.agents.list(actor);
		expect(agent?.expiresAt).toBeDefined();
		expect(
			await createAgentAction({}, form({ name: "", role: "editor" })),
		).toMatchObject({ error: expect.stringMatching(/^name/) });

		vi.spyOn(services.agents, "create").mockRejectedValueOnce(
			new Error("kaput"),
		);
		await expect(
			createAgentAction({}, form({ name: "Bot", role: "editor" })),
		).rejects.toThrow("kaput");

		expect(
			await redirectOf(revokeAgentAction(form({ id: agent?.id ?? "" }))),
		).toBe("/manage/agents?notice=Token revoked");
		expect(
			await redirectOf(deleteAgentAction(form({ id: agent?.id ?? "" }))),
		).toBe("/manage/agents?notice=Token deleted");
		expect(
			await redirectOf(deleteAgentAction(form({ id: agent?.id ?? "" }))),
		).toMatch(/error=Agent/);
		expect(await redirectOf(revokeAgentAction(form({ id: "nope" })))).toMatch(
			/error=Agent/,
		);
	});
});

describe("subscriber and settings actions", () => {
	it("manages subscribers", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		expect(
			await redirectOf(
				addSubscriberAction(
					form({ type: "webhook", target: "https://hooks.example.com/x" }),
				),
			),
		).toBe("/manage/subscribers?notice=Subscriber added");
		expect(
			await redirectOf(
				addSubscriberAction(form({ type: "email", target: "ops@acme.dev" })),
			),
		).toBe("/manage/subscribers?notice=Subscriber added");
		expect(
			await redirectOf(
				addSubscriberAction(form({ type: "webhook", target: "nope" })),
			),
		).toMatch(/error=url/);
		const [first] = await services.subscribers.list(actor);
		expect(
			await redirectOf(deleteSubscriberAction(form({ id: first?.id ?? "" }))),
		).toBe("/manage/subscribers?notice=Subscriber removed");
		expect(
			await redirectOf(deleteSubscriberAction(form({ id: first?.id ?? "" }))),
		).toMatch(/error=Subscriber/);
	});

	it("saves settings", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		const url = await redirectOf(
			updateSettingsAction(
				form({
					siteName: "Acme Status",
					description: "Hello",
					siteUrl: "https://status.acme.dev",
					logoUrl: "",
					faviconUrl: "",
					supportUrl: "https://acme.dev/help",
					theme: "midnight",
					brandColor: "#ff0066",
					customCss: ":root{}",
					allowSubscriptions: "on",
					uptimeDays: "30",
				}),
			),
		);
		expect(url).toBe("/manage/settings?notice=Settings saved");
		expect(await services.settings.get()).toMatchObject({
			siteName: "Acme Status",
			theme: "midnight",
			uptimeDays: 30,
			allowSubscriptions: true,
		});
		expect(
			await redirectOf(
				updateSettingsAction(
					form({ siteName: "Acme", theme: "default", brandColor: "pink" }),
				),
			),
		).toMatch(/error=brandColor/);
	});
});

describe("public subscribe actions", () => {
	it("subscribes and unsubscribes", async () => {
		const { notifier } = await setupApp();
		expect(
			await redirectOf(subscribeAction(form({ email: "jane@example.com" }))),
		).toBe("/subscribe?status=confirmation_sent");
		expect(await redirectOf(subscribeAction(form({ email: "bad" })))).toMatch(
			/^\/subscribe\?error=email/,
		);
		expect(await redirectOf(subscribeAction(new FormData()))).toMatch(
			/^\/subscribe\?error=/,
		);
		const token = notifier.confirmations[0]?.token ?? "";
		expect(await redirectOf(unsubscribeAction(form({ token })))).toBe(
			"/subscribe/unsubscribe?done=1",
		);
		expect(await redirectOf(unsubscribeAction(new FormData()))).toBe(
			"/subscribe/unsubscribe?done=1",
		);
	});

	it("rethrows unexpected subscribe errors", async () => {
		const { services } = await setupApp();
		vi.spyOn(services.subscribers, "subscribe").mockRejectedValueOnce(
			new Error("db down"),
		);
		await expect(subscribeAction(form({ email: "a@b.co" }))).rejects.toThrow(
			"db down",
		);
	});
});
