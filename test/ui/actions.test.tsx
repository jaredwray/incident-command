import {
	acceptInviteAction,
	addNotificationProviderAction,
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
	moveNotificationProviderAction,
	postIncidentUpdateAction,
	removeNotificationProviderAction,
	renewInviteLinkAction,
	revokeAgentAction,
	revokeInviteAction,
	saveDraftAction,
	setServiceStatusAction,
	setupAction,
	updateBrandingAction,
	updateGeneralSettingsAction,
	updateMemberAction,
	updateNotificationChannelAction,
	updateNotificationProviderAction,
	updateServiceAction,
} from "@/app/manage/actions";
import { subscribeAction, unsubscribeAction } from "@/app/subscribe/actions";
import { SESSION_COOKIE } from "@/lib/auth";
import type { Actor } from "@/lib/domain/types";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import {
	expectFlashRedirect,
	expectSameFlash,
	flashMessage,
	form,
	redirectOf,
	setupApp,
	signIn,
} from "./app";
import { cookieJar } from "./next-state";

describe("session actions", () => {
	it("sets up the first admin and signs them in", async () => {
		const { services } = await setupApp();
		const url = await redirectOf(
			setupAction(
				form({ name: "Ada", email: "ada@acme.dev", password: "password123" }),
			),
		);
		expectSameFlash(
			url,
			"/manage?notice=Welcome! Your admin account is ready.",
		);
		expect(cookieJar.get(SESSION_COOKIE)?.value).toBeTruthy();
		expect(cookieJar.get(SESSION_COOKIE)).toMatchObject({
			httpOnly: true,
			sameSite: "lax",
			path: "/",
		});
		expect(await services.members.count()).toBe(1);
		expectSameFlash(
			await redirectOf(
				setupAction(
					form({ name: "B", email: "b@acme.dev", password: "password123" }),
				),
			),
			"/manage/setup?error=Setup has already been completed",
		);
	});

	it("checks the setup token", async () => {
		await setupApp({ SETUP_TOKEN: "s3t" });
		expectSameFlash(
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
			"/manage/setup?error=Invalid setup token",
		);
	});

	it("logs in and out", async () => {
		const { services } = await setupApp();
		await services.members.setup({
			name: "Ada",
			email: "ada@acme.dev",
			password: "password123",
		});
		expectSameFlash(
			await redirectOf(
				loginAction(form({ email: "ada@acme.dev", password: "wrong" })),
			),
			"/manage/login?error=Invalid email or password",
		);
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
		expectSameFlash(
			await redirectOf(
				loginAction(form({ email: "ada@acme.dev", password: "wrong", next })),
			),
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
		expectSameFlash(
			await redirectOf(loginAction(new FormData())),
			"/manage/login?error=Invalid email or password",
		);
	});

	it("changes the signed-in member's password", async () => {
		const { app } = await setupApp();
		const { member } = await signIn(app, "viewer");
		expectSameFlash(
			await redirectOf(
				changePasswordAction(
					form({ currentPassword: "nope", newPassword: "password456" }),
				),
			),
			"/manage/account?error=Current password is incorrect",
		);
		expectSameFlash(
			await redirectOf(
				changePasswordAction(
					form({ currentPassword: "password123", newPassword: "password456" }),
				),
			),
			"/manage/account?notice=Password updated",
		);
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
		expectSameFlash(
			await redirectOf(createServiceAction(form({ name: "API" }))),
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
		expectSameFlash(
			created,
			`/manage/incidents/${incident?.id}?notice=Incident declared`,
		);
		expect(incident).toMatchObject({
			kind: "incident",
			impact: "critical",
			serviceIds: [api.id],
		});
		expect((await services.catalog.get(api.id)).status).toBe("major_outage");

		expectSameFlash(
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
			`/manage/incidents/${incident?.id}?notice=Update posted`,
		);
		expect((await services.incidents.get(incident?.id ?? "")).status).toBe(
			"resolved",
		);

		expectSameFlash(
			await redirectOf(
				editIncidentAction(
					form({
						id: incident?.id ?? "",
						title: "API outage",
						impact: "major",
					}),
				),
			),
			`/manage/incidents/${incident?.id}?notice=Incident saved`,
		);
		expect((await services.incidents.get(incident?.id ?? "")).title).toBe(
			"API outage",
		);

		expectSameFlash(
			await redirectOf(deleteIncidentAction(form({ id: incident?.id ?? "" }))),
			"/manage/incidents?notice=Incident deleted",
		);
		const deletedAgain = await redirectOf(
			deleteIncidentAction(form({ id: incident?.id ?? "" })),
		);
		expect(new URL(deletedAgain, "http://localhost").pathname).toBe(
			"/manage/incidents",
		);
		expect(flashMessage(deletedAgain, "error")).toBe(
			"That item was not found.",
		);
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
		expect(flashMessage(url, "notice")).toBe("Maintenance scheduled");
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
		expectSameFlash(
			await redirectOf(
				createIncidentAction(
					form({ kind: "maintenance", title: "x", message: "y" }),
				),
			),
			"/manage/incidents/new?kind=maintenance&error=Maintenance requires scheduledStart and scheduledEnd",
		);
		const titleError = await redirectOf(
			createIncidentAction(form({ title: "", message: "y" })),
		);
		expect(
			new URL(titleError, "http://localhost").searchParams.get("kind"),
		).toBe("incident");
		expect(flashMessage(titleError, "error")).toBe(
			"Check the form and try again.",
		);
		const missingUpdate = await redirectOf(
			postIncidentUpdateAction(form({ id: "nope", message: "x" })),
		);
		expect(new URL(missingUpdate, "http://localhost").pathname).toBe(
			"/manage/incidents/nope",
		);
		expect(flashMessage(missingUpdate, "error")).toBeTruthy();
		const missingEdit = await redirectOf(
			editIncidentAction(form({ id: "nope", title: "x" })),
		);
		expect(new URL(missingEdit, "http://localhost").pathname).toBe(
			"/manage/incidents/nope",
		);
		expect(flashMessage(missingEdit, "error")).toBeTruthy();
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
		expectSameFlash(
			await redirectOf(saveDraftAction(form(fields))),
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
		expectSameFlash(
			approved,
			`/manage/incidents/${incident?.id}?notice=Draft approved. The update is published and subscribers are notified.`,
		);
		expect(incident).toMatchObject({
			title: "Elevated API errors",
			status: "identified",
			serviceIds: [api.id],
		});
		expect(notifier.incidents).toHaveLength(1);
		expectSameFlash(
			await redirectOf(approveDraftAction(form(fields))),
			`/manage/drafts/${draft.id}?error=This draft was already approved`,
		);

		const update = await services.drafts.create(AGENT, {
			incidentId: incident?.id ?? "",
			message: "y",
		});
		// The form of an update has no title, impact, services or window.
		expectSameFlash(
			await redirectOf(
				saveDraftAction(
					form({ id: update.id, status: "monitoring", message: "Edited" }),
				),
			),
			`/manage/drafts/${update.id}?notice=Draft saved`,
		);
		expect((await services.drafts.get(update.id)).content).toMatchObject({
			status: "monitoring",
			message: "Edited",
		});
		expectSameFlash(
			await redirectOf(discardDraftAction(form({ id: update.id }))),
			"/manage/drafts?notice=Draft discarded",
		);
		expectSameFlash(
			await redirectOf(discardDraftAction(form({ id: update.id }))),
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
		expectSameFlash(
			await redirectOf(
				approveDraftAction(form({ id: draft.id, title: "x", message: "" })),
			),
			`/manage/drafts/${draft.id}?error=validation_failed`,
		);
		expect((await services.drafts.get(draft.id)).state).toBe("pending");
		await signIn(app, "viewer");
		expectSameFlash(
			await redirectOf(discardDraftAction(form({ id: draft.id }))),
			"/manage?error=That page requires the editor role",
		);
	});
});

describe("service actions", () => {
	it("creates, edits, sets status and deletes services", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		expectSameFlash(
			await redirectOf(
				createServiceAction(
					form({ name: "API", group: "Core", description: "", hidden: "on" }),
				),
			),
			"/manage/services?notice=Service created",
		);
		const [api] = await services.catalog.list();
		expect(api).toMatchObject({ name: "API", group: "Core", hidden: true });

		expectSameFlash(
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
			"/manage/services?notice=Service saved",
		);
		const updated = await services.catalog.get(api?.id ?? "");
		expect(updated).toMatchObject({
			name: "REST API",
			description: "Public",
			order: 4,
			hidden: false,
		});
		expect(updated.group).toBeUndefined();

		expectSameFlash(
			await redirectOf(
				updateServiceAction(
					form({ id: api?.id ?? "", name: "REST API", order: "" }),
				),
			),
			"/manage/services?notice=Service saved",
		);

		expectSameFlash(
			await redirectOf(
				setServiceStatusAction(
					form({ id: api?.id ?? "", status: "partial_outage" }),
				),
			),
			"/manage/services?notice=Status updated",
		);
		expect((await services.catalog.get(api?.id ?? "")).status).toBe(
			"partial_outage",
		);
		expect(
			flashMessage(
				await redirectOf(
					setServiceStatusAction(form({ id: api?.id ?? "", status: "bogus" })),
				),
				"error",
			),
		).toBeTruthy();

		expectSameFlash(
			await redirectOf(deleteServiceAction(form({ id: api?.id ?? "" }))),
			"/manage/services?notice=Service deleted",
		);
		expect(
			flashMessage(
				await redirectOf(deleteServiceAction(form({ id: api?.id ?? "" }))),
				"error",
			),
		).toBe("That item was not found.");
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

		expectSameFlash(
			await redirectOf(revokeInviteAction(form({ id: invite?.id ?? "" }))),
			"/manage/members?notice=Invite revoked",
		);
		expect(
			flashMessage(
				await redirectOf(revokeInviteAction(form({ id: invite?.id ?? "" }))),
				"error",
			),
		).toBe("That item was not found.");
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
		expectSameFlash(
			await redirectOf(
				acceptInviteAction(form({ token, name: "Ed", password: "short" })),
			),
			`/manage/invite?token=${token}&error=validation_failed`,
		);
		expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
		expectSameFlash(
			await redirectOf(
				acceptInviteAction(
					form({ token, name: "Ed", password: "password123" }),
				),
			),
			"/manage?notice=Welcome! Your account is ready.",
		);
		const session = await services.sessions.resolve(
			cookieJar.get(SESSION_COOKIE)?.value,
		);
		expect(session?.member).toMatchObject({
			email: "ed@acme.dev",
			name: "Ed",
			role: "editor",
		});
		expectSameFlash(
			await redirectOf(
				acceptInviteAction(
					form({ token, name: "Ed", password: "password123" }),
				),
			),
			`/manage/invite?token=${token}&error=invite_invalid`,
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
		expectSameFlash(
			await redirectOf(
				updateMemberAction(form({ id: ed.id, role: "viewer", password: "" })),
			),
			"/manage/members?notice=Member updated",
		);
		expect((await services.members.get(ed.id))?.role).toBe("viewer");
		expectSameFlash(
			await redirectOf(
				updateMemberAction(form({ id: ed.id, password: "newpassword1" })),
			),
			"/manage/members?notice=Member updated",
		);
		expectSameFlash(
			await redirectOf(deleteMemberAction(form({ id: ed.id }))),
			"/manage/members?notice=Member removed",
		);
		expect(
			flashMessage(
				await redirectOf(updateMemberAction(form({ id: "nope" }))),
				"error",
			),
		).toBe("That item was not found.");
		expectSameFlash(
			await redirectOf(deleteMemberAction(form({ id: actor.id }))),
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

		expectSameFlash(
			await redirectOf(revokeAgentAction(form({ id: agent?.id ?? "" }))),
			"/manage/agents?notice=Token revoked",
		);
		expectSameFlash(
			await redirectOf(deleteAgentAction(form({ id: agent?.id ?? "" }))),
			"/manage/agents?notice=Token deleted",
		);
		expect(
			flashMessage(
				await redirectOf(deleteAgentAction(form({ id: agent?.id ?? "" }))),
				"error",
			),
		).toBe("That item was not found.");
		expect(
			flashMessage(
				await redirectOf(revokeAgentAction(form({ id: "nope" }))),
				"error",
			),
		).toBe("That item was not found.");
	});
});

describe("subscriber and settings actions", () => {
	it("manages subscribers", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		expectSameFlash(
			await redirectOf(
				addSubscriberAction(
					form({ type: "webhook", target: "https://hooks.example.com/x" }),
				),
			),
			"/manage/subscribers?notice=Subscriber added",
		);
		expectSameFlash(
			await redirectOf(
				addSubscriberAction(form({ type: "email", target: "ops@acme.dev" })),
			),
			"/manage/subscribers?notice=Subscriber added",
		);
		expectSameFlash(
			await redirectOf(
				addSubscriberAction(form({ type: "sms", target: "+1 555 123 4567" })),
			),
			"/manage/subscribers?notice=Subscriber added",
		);
		expect(
			(await services.subscribers.list(actor)).map((item) => item.target),
		).toContain("+15551234567");
		expect(
			flashMessage(
				await redirectOf(
					addSubscriberAction(form({ type: "webhook", target: "nope" })),
				),
				"error",
			),
		).toBe("Check the form and try again.");
		const [first] = await services.subscribers.list(actor);
		expectSameFlash(
			await redirectOf(deleteSubscriberAction(form({ id: first?.id ?? "" }))),
			"/manage/subscribers?notice=Subscriber removed",
		);
		expect(
			flashMessage(
				await redirectOf(deleteSubscriberAction(form({ id: first?.id ?? "" }))),
				"error",
			),
		).toBe("That item was not found.");
	});

	it("saves the general settings without touching branding", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		await services.settings.update(SYSTEM_ACTOR, { theme: "ocean" });
		const url = await redirectOf(
			updateGeneralSettingsAction(
				form({
					siteName: "Acme Status",
					description: "Hello",
					siteUrl: "https://status.acme.dev",
					supportUrl: "https://acme.dev/help",
					allowSubscriptions: "on",
					uptimeDays: "30",
				}),
			),
		);
		expectSameFlash(url, "/manage/settings?notice=Settings saved");
		expect(await services.settings.get()).toMatchObject({
			siteName: "Acme Status",
			siteUrl: "https://status.acme.dev",
			theme: "ocean",
			uptimeDays: 30,
			allowSubscriptions: true,
		});
		expectFlashRedirect(
			await redirectOf(
				updateGeneralSettingsAction(form({ siteName: "", uptimeDays: "1" })),
			),
			"/manage/settings",
			"error",
			"Check the form and try again.",
		);
	});

	it("saves branding without touching the general settings", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		await services.settings.update(SYSTEM_ACTOR, {
			allowSubscriptions: true,
			uptimeDays: 30,
		});
		const url = await redirectOf(
			updateBrandingAction(
				form({
					theme: "midnight",
					brandColor: "#ff0066",
					logoUrl: "",
					faviconUrl: "",
					customCss: ":root{}",
				}),
			),
		);
		expectSameFlash(url, "/manage/settings/branding?notice=Branding saved");
		expect(await services.settings.get()).toMatchObject({
			theme: "midnight",
			brandColor: "#ff0066",
			customCss: ":root{}",
			allowSubscriptions: true,
			uptimeDays: 30,
		});
		expectFlashRedirect(
			await redirectOf(
				updateBrandingAction(form({ theme: "default", brandColor: "pink" })),
			),
			"/manage/settings/branding",
			"error",
			"Check the form and try again.",
		);
	});
});

describe("notification settings actions", () => {
	const PATH = "/manage/settings/notifications";

	it("saves a channel", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		expectSameFlash(
			await redirectOf(
				updateNotificationChannelAction(
					form({
						channel: "email",
						strategy: "load_balanced",
						from: "Acme <status@acme.dev>",
					}),
				),
			),
			`${PATH}?notice=Channel saved`,
		);
		expect((await services.notificationSettings.list(actor))[1]).toMatchObject({
			enabled: false,
			strategy: "load_balanced",
			from: "Acme <status@acme.dev>",
		});
		await redirectOf(
			updateNotificationChannelAction(
				form({ channel: "webhook", enabled: "on", strategy: "active_passive" }),
			),
		);
		expect((await services.notificationSettings.list(actor))[0]?.enabled).toBe(
			true,
		);
		expectFlashRedirect(
			await redirectOf(
				updateNotificationChannelAction(
					form({ channel: "email", strategy: "active_passive", from: "nope" }),
				),
			),
			PATH,
			"error",
			"Check the form and try again.",
		);
	});

	it("refuses a channel form that shows an old revision", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		await services.notificationSettings.updateChannel(actor, "email", {
			enabled: false,
		});
		expectFlashRedirect(
			await redirectOf(
				updateNotificationChannelAction(
					form({
						channel: "email",
						revision: "0",
						enabled: "on",
						strategy: "active_passive",
					}),
				),
			),
			PATH,
			"error",
			"Somebody else changed these notification settings. Reload the page.",
		);
		expect((await services.notificationSettings.list(actor))[1]?.enabled).toBe(
			false,
		);
	});

	it("needs an encryption key to add a provider with credentials", async () => {
		const { app } = await setupApp();
		await signIn(app, "admin");
		expectFlashRedirect(
			await redirectOf(
				addNotificationProviderAction(
					form({
						channel: "email",
						type: "sendgrid",
						name: "SendGrid",
						field_apiKey: "SG.key",
					}),
				),
			),
			PATH,
			"error",
			"Set ENCRYPTION_KEY on the server before you save provider credentials.",
		);
	});

	it("adds, edits, orders and removes providers", async () => {
		const { app, services } = await setupApp({
			ENCRYPTION_KEY: "k".repeat(32),
		});
		const { actor } = await signIn(app, "admin");
		const providers = async () =>
			(await services.notificationSettings.list(actor))[2]?.providers ?? [];
		for (const name of ["Twilio", "SNS"]) {
			expectSameFlash(
				await redirectOf(
					addNotificationProviderAction(
						form(
							name === "Twilio"
								? {
										channel: "sms",
										type: "twilio",
										name,
										from: "+15550001111",
										field_accountSid: `AC${"1".repeat(32)}`,
										field_authToken: "tok",
									}
								: {
										channel: "sms",
										type: "sns",
										name,
										from: "",
										field_region: "us-east-1",
										field_accessKeyId: "",
										field_secretAccessKey: "",
									},
						),
					),
				),
				`${PATH}?notice=Provider added`,
			);
		}
		const [twilio, sns] = await providers();
		expect(twilio).toMatchObject({
			name: "Twilio",
			from: "+15550001111",
			options: { accountSid: `AC${"1".repeat(32)}` },
			savedSecrets: ["authToken"],
		});
		expect(sns).toMatchObject({ options: { region: "us-east-1" } });
		expect(sns?.from).toBeUndefined();

		expectSameFlash(
			await redirectOf(
				updateNotificationProviderAction(
					form({
						channel: "sms",
						id: twilio?.id ?? "",
						name: "Twilio primary",
						from: "",
						field_accountSid: `AC${"1".repeat(32)}`,
						field_authToken: "",
					}),
				),
			),
			`${PATH}?notice=Provider saved`,
		);
		expect((await providers())[0]).toMatchObject({
			name: "Twilio primary",
			savedSecrets: ["authToken"],
		});
		expect((await providers())[0]?.from).toBeUndefined();

		expectSameFlash(
			await redirectOf(
				moveNotificationProviderAction(
					form({ channel: "sms", id: sns?.id ?? "", direction: "up" }),
				),
			),
			`${PATH}?notice=Provider order saved`,
		);
		expect((await providers()).map((item) => item.name)).toEqual([
			"SNS",
			"Twilio primary",
		]);

		expectSameFlash(
			await redirectOf(
				removeNotificationProviderAction(
					form({ channel: "sms", id: sns?.id ?? "" }),
				),
			),
			`${PATH}?notice=Provider removed`,
		);
		expect((await providers()).map((item) => item.name)).toEqual([
			"Twilio primary",
		]);

		for (const action of [
			() =>
				updateNotificationProviderAction(
					form({ channel: "sms", id: "prv_missing", name: "x" }),
				),
			() =>
				moveNotificationProviderAction(
					form({ channel: "sms", id: "prv_missing", direction: "up" }),
				),
			() =>
				removeNotificationProviderAction(
					form({ channel: "sms", id: "prv_missing" }),
				),
		]) {
			expectFlashRedirect(
				await redirectOf(action()),
				PATH,
				"error",
				"That item was not found.",
			);
		}
	});

	it("requires the admin role", async () => {
		const { app } = await setupApp();
		await signIn(app, "editor");
		expectFlashRedirect(
			await redirectOf(
				updateNotificationChannelAction(form({ channel: "email" })),
			),
			"/manage",
			"error",
			"That page requires the admin role",
		);
	});
});

describe("public subscribe actions", () => {
	it("subscribes and unsubscribes", async () => {
		const { notifier } = await setupApp();
		expect(
			await redirectOf(subscribeAction(form({ email: "jane@example.com" }))),
		).toBe("/subscribe?status=confirmation_sent");
		const badEmail = await redirectOf(subscribeAction(form({ email: "bad" })));
		expect(new URL(badEmail, "http://localhost").pathname).toBe("/subscribe");
		expect(flashMessage(badEmail, "error")).toBe(
			"Check the form and try again.",
		);
		const emptyEmail = await redirectOf(subscribeAction(new FormData()));
		expect(new URL(emptyEmail, "http://localhost").pathname).toBe("/subscribe");
		expect(flashMessage(emptyEmail, "error")).toBeTruthy();
		const token = notifier.confirmations[0]?.subscriber.token ?? "";
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
