import { render, screen, within } from "@testing-library/react";
import AccountPage from "@/app/manage/account/page";
import AgentsPage from "@/app/manage/agents/page";
import DraftPage from "@/app/manage/drafts/[id]/page";
import DraftsPage from "@/app/manage/drafts/page";
import IncidentPage from "@/app/manage/incidents/[id]/page";
import NewIncidentPage from "@/app/manage/incidents/new/page";
import IncidentsPage from "@/app/manage/incidents/page";
import InvitePage from "@/app/manage/invite/page";
import LoginPage from "@/app/manage/login/page";
import MembersPage from "@/app/manage/members/page";
import DashboardPage from "@/app/manage/page";
import ServicesPage from "@/app/manage/services/page";
import SettingsPage from "@/app/manage/settings/page";
import SetupPage from "@/app/manage/setup/page";
import SubscribersPage from "@/app/manage/subscribers/page";
import type { Actor } from "@/lib/domain/types";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import { expectNotFound, params, redirectOf, setupApp, signIn } from "./app";
import { setRequestHeaders } from "./next-state";

const flash = (value: Record<string, string> = {}) => ({
	searchParams: params(value),
});

const AGENT: Actor = {
	type: "agent",
	id: "agt_bot",
	name: "Ops bot",
	role: "editor",
};

describe("login and setup", () => {
	it("sends visitors to setup until an admin exists", async () => {
		await setupApp();
		expect(await redirectOf(LoginPage(flash()))).toBe("/manage/setup");
		render(await SetupPage(flash({ error: "Bad input" })));
		expect(
			screen.getByRole("heading", { name: "Create the first admin" }),
		).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("Bad input");
		expect(screen.queryByLabelText("Setup token")).not.toBeInTheDocument();
	});

	it("asks for the setup token when configured", async () => {
		await setupApp({ SETUP_TOKEN: "s3t" });
		render(await SetupPage(flash()));
		expect(screen.getByLabelText("Setup token")).toBeInTheDocument();
	});

	it("shows the invite form for an open invite link", async () => {
		const { services } = await setupApp();
		const { token } = await services.members.invite(SYSTEM_ACTOR, {
			email: "ed@acme.dev",
			role: "viewer",
		});
		render(await InvitePage(flash({ token, error: "Bad input" })));
		expect(
			screen.getByRole("heading", { name: "Create your account" }),
		).toBeInTheDocument();
		expect(screen.getByText(/with the Viewer role/)).toBeInTheDocument();
		expect(screen.getByLabelText("Email")).toHaveValue("ed@acme.dev");
		expect(screen.getByRole("alert")).toHaveTextContent("Bad input");
		expect(
			document.querySelector('input[name="token"]') as HTMLInputElement,
		).toHaveValue(token);
	});

	it("explains when an invite link is not valid", async () => {
		await setupApp();
		for (const query of [{}, { token: "bogus" }] as Record<string, string>[]) {
			const page = render(await InvitePage(flash(query)));
			expect(
				screen.getByRole("heading", { name: "Invite not valid" }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("link", { name: "Go to sign in" }),
			).toHaveAttribute("href", "/manage/login");
			page.unmount();
		}
	});

	it("shows the login form and redirects signed-in members", async () => {
		const { app } = await setupApp();
		await app.services.members.setup({
			name: "Ada",
			email: "ada@acme.dev",
			password: "password123",
		});
		expect(await redirectOf(SetupPage(flash()))).toBe("/manage/login");
		const page = render(
			await LoginPage(flash({ error: "Invalid email or password" })),
		);
		expect(
			screen.getByRole("heading", { name: "Sign in" }),
		).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Invalid email or password",
		);
		page.unmount();
		await signIn(app, "viewer");
		expect(await redirectOf(LoginPage(flash()))).toBe("/manage");
	});

	it("keeps the return path of a portal link through sign-in", async () => {
		const { app } = await setupApp();
		await app.services.members.setup({
			name: "Ada",
			email: "ada@acme.dev",
			password: "password123",
		});
		render(await LoginPage(flash({ next: "/manage/drafts/drf_1" })));
		expect(
			document.querySelector('input[name="next"]') as HTMLInputElement,
		).toHaveValue("/manage/drafts/drf_1");
		await signIn(app, "viewer");
		expect(
			await redirectOf(LoginPage(flash({ next: "/manage/drafts/drf_1" }))),
		).toBe("/manage/drafts/drf_1");
		expect(
			await redirectOf(LoginPage(flash({ next: "https://evil.example" }))),
		).toBe("/manage");
	});

	it("redirects anonymous visitors to login", async () => {
		await setupApp();
		expect(await redirectOf(DashboardPage(flash()))).toBe("/manage/login");
	});
});

describe("dashboard", () => {
	it("summarizes open incidents for editors", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "x",
			impact: "critical",
			serviceIds: [api.id],
		});
		render(await DashboardPage(flash({ notice: "Welcome" })));
		expect(screen.getByRole("status")).toHaveTextContent("Welcome");
		expect(
			screen.getByRole("link", { name: "Declare incident" }),
		).toHaveAttribute("href", "/manage/incidents/new");
		expect(
			screen.getByRole("link", { name: "API errors" }),
		).toBeInTheDocument();
		expect(screen.getByText("Major outage")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(
			screen.queryByRole("link", { name: "Members" }),
		).not.toBeInTheDocument();
	});

	it("shows an empty state, admin navigation and store outages", async () => {
		const { app } = await setupApp();
		await signIn(app, "admin");
		vi.spyOn(app.store, "health", "get").mockReturnValue({
			online: false,
			kind: "memory",
			lastError: "connection refused",
		});
		render(await DashboardPage(flash()));
		expect(screen.getByText("Nothing open. All quiet.")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"The database is unreachable (connection refused)",
		);
	});

	it("hides edit actions from viewers", async () => {
		const { app } = await setupApp();
		await signIn(app, "viewer");
		render(await DashboardPage(flash()));
		expect(
			screen.queryByRole("link", { name: "Declare incident" }),
		).not.toBeInTheDocument();
	});

	it("rejects members without the required role", async () => {
		const { app } = await setupApp();
		await signIn(app, "editor");
		expect(await redirectOf(MembersPage(flash()))).toBe(
			"/manage?error=That page requires the admin role",
		);
	});
});

describe("incident pages", () => {
	it("lists open and resolved incidents", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const open = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Open one",
			message: "x",
		});
		await services.incidents.postUpdate(SYSTEM_ACTOR, open.id, {
			message: "More",
		});
		await services.incidents.create(SYSTEM_ACTOR, {
			title: "Closed one",
			message: "x",
			status: "resolved",
		});
		await services.incidents.create(SYSTEM_ACTOR, {
			kind: "maintenance",
			title: "Planned",
			message: "x",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		render(await IncidentsPage(flash()));
		expect(screen.getByRole("link", { name: "Open one" })).toBeInTheDocument();
		expect(screen.getByText(/2 updates/)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Closed one" }),
		).toBeInTheDocument();
		expect(screen.getAllByText(/Maintenance ·/)).toHaveLength(1);
		expect(
			screen.getByRole("link", { name: "Schedule maintenance" }),
		).toBeInTheDocument();
	});

	it("shows empty states for viewers", async () => {
		const { app } = await setupApp();
		await signIn(app, "viewer");
		render(await IncidentsPage(flash()));
		expect(
			screen.getByText("No open incidents or maintenance."),
		).toBeInTheDocument();
		expect(screen.getByText("Nothing resolved yet.")).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Declare incident" }),
		).not.toBeInTheDocument();
	});

	it("renders the new incident and maintenance forms", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const page = render(
			await NewIncidentPage(flash({ error: "title: Too small" })),
		);
		expect(
			screen.getByRole("heading", { name: "Declare an incident" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Impact")).toBeInTheDocument();
		expect(screen.getByText("No services yet.")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent("title: Too small");
		page.unmount();

		await services.catalog.create(SYSTEM_ACTOR, {
			name: "API",
			group: "Core",
		});
		render(await NewIncidentPage(flash({ kind: "maintenance" })));
		expect(
			screen.getByRole("heading", { name: "Schedule maintenance" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Starts (UTC)")).toBeInTheDocument();
		expect(screen.queryByLabelText("Impact")).not.toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: /API/ })).toBeInTheDocument();
		expect(
			within(screen.getByLabelText("Status"))
				.getAllByRole("option")
				.map((o) => o.textContent),
		).toEqual(["Scheduled", "In progress", "Verifying", "Completed"]);
	});

	it("renders incident management for editors", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "Looking",
			serviceIds: [api.id],
		});
		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "API errors" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "View public page" }),
		).toHaveAttribute("href", `/incidents/${incident.id}`);
		expect(
			screen.getByRole("button", { name: "Post update" }),
		).toBeInTheDocument();
		expect(screen.getByDisplayValue("API errors")).toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: /API/ })).toBeChecked();
		expect(screen.getByText(/System \(system\)/)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Delete incident" }),
		).toBeInTheDocument();
	});

	it("renders maintenance details and read-only views", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const maintenance = await services.incidents.create(SYSTEM_ACTOR, {
			kind: "maintenance",
			title: "Upgrade",
			message: "x",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		const editor = render(
			await IncidentPage({
				params: params({ id: maintenance.id }),
				searchParams: params({}),
			}),
		);
		expect(screen.getByLabelText("Starts (UTC)")).toHaveValue(
			"2026-11-05T00:00",
		);
		editor.unmount();

		const { app: viewerApp, services: viewerServices } = await setupApp();
		await signIn(viewerApp, "viewer");
		const incident = await viewerServices.incidents.create(SYSTEM_ACTOR, {
			title: "Read only",
			message: "x",
		});
		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(
			screen.queryByRole("button", { name: "Post update" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Delete incident" }),
		).not.toBeInTheDocument();
	});

	it("404s for unknown incidents", async () => {
		const { app } = await setupApp();
		await signIn(app, "viewer");
		await expectNotFound(
			IncidentPage({
				params: params({ id: "nope" }),
				searchParams: params({}),
			}),
		);
	});
});

describe("notification draft pages", () => {
	const draftPage = (id: string) =>
		DraftPage({ params: params({ id }), searchParams: params({}) });

	it("lists drafts that wait for review and reviewed drafts", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "editor");
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Database slow",
			message: "x",
			notify: false,
		});
		const created = await services.drafts.create(AGENT, {
			title: "API errors",
			message: "x",
		});
		const update = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "y",
		});
		const orphan = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Gone",
			message: "x",
			notify: false,
		});
		await services.drafts.create(AGENT, {
			incidentId: orphan.id,
			message: "z",
		});
		await services.incidents.delete(SYSTEM_ACTOR, orphan.id);
		const discarded = await services.drafts.create(AGENT, {
			kind: "maintenance",
			title: "Upgrade",
			message: "x",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		await services.drafts.discard(actor, discarded.id);

		render(await DraftsPage(flash({ notice: "Draft discarded" })));
		expect(screen.getByRole("status")).toHaveTextContent("Draft discarded");
		expect(screen.getByRole("link", { name: "Drafts" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "API errors" })).toHaveAttribute(
			"href",
			`/manage/drafts/${created.id}`,
		);
		expect(screen.getByRole("link", { name: "Database slow" })).toHaveAttribute(
			"href",
			`/manage/drafts/${update.id}`,
		);
		expect(
			screen.getByRole("link", { name: "Deleted incident" }),
		).toBeInTheDocument();
		expect(
			screen.getAllByText(/New incident · Drafted by Ops bot/),
		).toHaveLength(1);
		expect(screen.getAllByText(/Incident update · Drafted by/)).toHaveLength(2);
		expect(screen.getAllByText("Waiting for review")).toHaveLength(4);
		expect(screen.getByText("Discarded by Editor User")).toBeInTheDocument();
		expect(screen.getByText(/New maintenance/)).toBeInTheDocument();
	});

	it("shows empty states", async () => {
		const { app } = await setupApp();
		await signIn(app, "viewer");
		render(await DraftsPage(flash()));
		expect(screen.getByText("No drafts wait for review.")).toBeInTheDocument();
		expect(screen.getByText("No reviewed drafts yet.")).toBeInTheDocument();
	});

	it("sends a visitor to sign-in and back to the draft", async () => {
		await setupApp();
		expect(await redirectOf(draftPage("drf_1"))).toBe(
			"/manage/login?next=/manage/drafts/drf_1",
		);
	});

	it("lets editors review a new incident", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		await services.catalog.create(SYSTEM_ACTOR, { name: "Web" });
		const draft = await services.drafts.create(AGENT, {
			title: "API errors",
			message: "We are looking into errors.",
			impact: "critical",
			serviceIds: [api.id],
			serviceStatus: "partial_outage",
		});
		render(await draftPage(draft.id));
		expect(
			screen.getByRole("heading", { level: 1, name: "API errors" }),
		).toBeInTheDocument();
		expect(screen.getByText(/This draft waits for review/)).toBeInTheDocument();
		expect(screen.getByLabelText("Title")).toHaveValue("API errors");
		expect(screen.getByLabelText("Status")).toHaveValue("investigating");
		expect(screen.getByLabelText("Impact")).toHaveValue("critical");
		expect(screen.getByLabelText("Message")).toHaveValue(
			"We are looking into errors.",
		);
		expect(screen.getByRole("checkbox", { name: /API/ })).toBeChecked();
		expect(screen.getByRole("checkbox", { name: /Web/ })).not.toBeChecked();
		expect(screen.getByLabelText("Set affected services to")).toHaveValue(
			"partial_outage",
		);
		const buttons = screen
			.getAllByRole("button")
			.map((button) => button.textContent);
		expect(buttons).toEqual(
			expect.arrayContaining(["Save draft", "Approve and send"]),
		);
		// Enter in a field submits the first button, so Save must come first.
		expect(buttons.indexOf("Save draft")).toBeLessThan(
			buttons.indexOf("Approve and send"),
		);
		expect(
			screen.getByRole("button", { name: "Discard draft" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "View incident" }),
		).not.toBeInTheDocument();
	});

	it("lets editors review new maintenance and an update", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const maintenance = await services.drafts.create(AGENT, {
			kind: "maintenance",
			title: "Upgrade",
			message: "x",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		const page = render(await draftPage(maintenance.id));
		expect(screen.getByLabelText("Starts (UTC)")).toHaveValue(
			"2026-11-05T00:00",
		);
		expect(screen.getByLabelText("Status")).toHaveValue("scheduled");
		expect(screen.queryByLabelText("Impact")).not.toBeInTheDocument();
		page.unmount();

		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "x",
			status: "identified",
			notify: false,
		});
		const update = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "A fix is ready.",
		});
		render(await draftPage(update.id));
		expect(
			screen.getByRole("heading", { level: 1, name: "API errors" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Incident update · Drafted by Ops bot/),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Status")).toHaveValue("identified");
		expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
		expect(screen.queryByText("Affected services")).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "View incident" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}`,
		);
	});

	it("shows a read-only draft to viewers and after review", async () => {
		const { app, services } = await setupApp();
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const draft = await services.drafts.create(AGENT, {
			kind: "maintenance",
			title: "Upgrade",
			message: "We upgrade the database.",
			status: "scheduled",
			impact: "minor",
			serviceIds: [api.id],
			serviceStatus: "under_maintenance",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		await signIn(app, "viewer");
		const viewer = render(await draftPage(draft.id));
		for (const text of [
			"Scheduled",
			"Minor",
			"API",
			"Under maintenance",
			"We upgrade the database.",
		]) {
			expect(screen.getByText(text)).toBeInTheDocument();
		}
		expect(screen.getByText("Window", { selector: "dt" })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Approve and send" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Discard draft" }),
		).not.toBeInTheDocument();
		viewer.unmount();

		const { actor } = await signIn(app, "editor");
		const { incident } = await services.drafts.approve(
			actor,
			draft.id,
			draft.content,
		);
		const approved = render(await draftPage(draft.id));
		expect(screen.getByText(/Approved by Editor User/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "View incident" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}`,
		);
		expect(
			screen.queryByRole("button", { name: "Discard draft" }),
		).not.toBeInTheDocument();
		approved.unmount();

		const update = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "Nothing to add.",
		});
		await services.drafts.discard(actor, update.id);
		render(await draftPage(update.id));
		expect(
			screen.getByText(
				/Discarded by Editor User .*Nothing was published or sent/,
			),
		).toBeInTheDocument();
		expect(screen.getByText("Nothing to add.")).toBeInTheDocument();
		expect(
			screen.queryByText("Status", { selector: "dt" }),
		).not.toBeInTheDocument();
	});

	it("only offers to discard a draft whose incident was deleted", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Gone",
			message: "x",
			notify: false,
		});
		const draft = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "y",
		});
		await services.incidents.delete(SYSTEM_ACTOR, incident.id);
		render(await draftPage(draft.id));
		expect(
			screen.getByRole("heading", { level: 1, name: "Deleted incident" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Somebody deleted the incident of this draft/),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Approve and send" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Discard draft" }),
		).toBeInTheDocument();
	});

	it("404s for unknown drafts", async () => {
		const { app } = await setupApp();
		await signIn(app, "viewer");
		await expectNotFound(draftPage("drf_missing"));
	});
});

describe("services page", () => {
	it("lets editors manage services", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		await services.catalog.create(SYSTEM_ACTOR, {
			name: "API",
			group: "Core",
			description: "Public API",
			hidden: true,
		});
		await services.catalog.create(SYSTEM_ACTOR, { name: "Web" });
		render(await ServicesPage(flash()));
		expect(screen.getByText("(hidden)")).toBeInTheDocument();
		expect(screen.getByText("Core · order 0")).toBeInTheDocument();
		expect(screen.getByText("order 1")).toBeInTheDocument();
		expect(screen.getByLabelText("Status of API")).toHaveValue("operational");
		expect(
			screen.getByRole("button", { name: "Add service" }),
		).toBeInTheDocument();
		expect(
			screen.getAllByRole("button", { name: "Delete service" }),
		).toHaveLength(2);
	});

	it("is read-only for viewers", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "viewer");
		const page = render(await ServicesPage(flash()));
		expect(screen.getByText(/No services yet/)).toBeInTheDocument();
		page.unmount();
		await services.catalog.create(SYSTEM_ACTOR, {
			name: "API",
			status: "partial_outage",
		});
		render(await ServicesPage(flash()));
		expect(screen.getByText("Partial outage")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Add service" }),
		).not.toBeInTheDocument();
	});
});

describe("admin pages", () => {
	it("lists members", async () => {
		const { app } = await setupApp();
		const { member } = await signIn(app, "admin");
		await app.services.members.authenticate({
			email: member.email,
			password: "password123",
		});
		const { token } = await app.services.members.invite(SYSTEM_ACTOR, {
			email: "ed@acme.dev",
		});
		await app.services.members.acceptInvite(token, {
			name: "Ed",
			password: "password123",
		});
		const page = render(await MembersPage(flash()));
		expect(screen.getByText("(you)")).toBeInTheDocument();
		expect(screen.getByText(/Last sign-in/)).toBeInTheDocument();
		expect(screen.getByText(/Never signed in/)).toBeInTheDocument();
		expect(screen.getByLabelText("Role for Ed")).toHaveValue("editor");
		expect(
			screen.queryByRole("heading", { name: "Open invites" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Create invite link" }),
		).toBeInTheDocument();
		page.unmount();
	});

	it("lists open and expired invites", async () => {
		const { app, services, clock } = await setupApp();
		await services.members.invite(SYSTEM_ACTOR, {
			email: "old@acme.dev",
			role: "viewer",
		});
		clock.advance(6 * 86_400_000);
		const { actor } = await signIn(app, "admin");
		await services.members.invite(actor, { email: "new@acme.dev" });
		clock.advance(2 * 86_400_000);
		vi.useFakeTimers({ now: clock.current, toFake: ["Date"] });
		render(await MembersPage(flash()));
		vi.useRealTimers();
		const invites = within(
			screen
				.getByRole("heading", { name: "Open invites" })
				.closest("section") as HTMLElement,
		);
		const [fresh, stale] = invites.getAllByRole("listitem");
		expect(fresh).toHaveTextContent("new@acme.dev");
		expect(fresh).toHaveTextContent(/Editor · Invited by Admin User · Expires/);
		expect(stale).toHaveTextContent("old@acme.dev");
		expect(stale).toHaveTextContent(/Viewer · Invited by System · Expired/);
		expect(invites.getAllByRole("button", { name: "Revoke" })).toHaveLength(2);
		// only an open invite can get a new link
		expect(
			within(fresh as HTMLElement).getByRole("button", { name: "Copy link" }),
		).toBeEnabled();
		expect(
			within(stale as HTMLElement).queryByRole("button", { name: "Copy link" }),
		).not.toBeInTheDocument();
	});

	it("shows agent tokens and MCP instructions", async () => {
		const { app, services, clock } = await setupApp();
		const { actor } = await signIn(app, "admin");
		setRequestHeaders({
			host: "status.acme.dev",
			"x-forwarded-proto": "https",
		});
		const empty = render(await AgentsPage(flash()));
		expect(screen.getByText("No agent tokens yet.")).toBeInTheDocument();
		expect(
			screen.getAllByText(/https:\/\/status\.acme\.dev\/api\/mcp/).length,
		).toBeGreaterThan(0);
		empty.unmount();

		const used = await services.agents.create(actor, {
			name: "Used bot",
			description: "Pager bridge",
			expiresInDays: 30,
		});
		await services.agents.authenticate(used.token);
		const revoked = await services.agents.create(actor, {
			name: "Revoked bot",
		});
		await services.agents.revoke(actor, revoked.agent.id);
		await services.agents.create(actor, {
			name: "Expired bot",
			expiresInDays: 1,
		});
		clock.advance(2 * 86_400_000);
		vi.useFakeTimers({ now: clock.current, toFake: ["Date"] });
		render(await AgentsPage(flash()));
		vi.useRealTimers();
		expect(screen.getByText("Pager bridge")).toBeInTheDocument();
		expect(screen.getByText("active")).toBeInTheDocument();
		expect(screen.getByText("revoked")).toBeInTheDocument();
		expect(screen.getByText("expired")).toBeInTheDocument();
		expect(screen.getAllByText(/Never used/)).toHaveLength(2);
		expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
	});

	it("uses the configured site url for the MCP endpoint", async () => {
		const { app } = await setupApp({ SITE_URL: "https://status.example.com" });
		await signIn(app, "admin");
		render(await AgentsPage(flash()));
		expect(
			screen.getAllByText(/https:\/\/status\.example\.com\/api\/mcp/).length,
		).toBeGreaterThan(0);
	});

	it("lists subscribers and warns when email is off", async () => {
		const { app, services, notifier } = await setupApp();
		const { actor } = await signIn(app, "admin");
		notifier.emailEnabled = false;
		const empty = render(await SubscribersPage(flash()));
		expect(screen.getByText(/Email is not configured/)).toBeInTheDocument();
		expect(screen.getByText("No subscribers yet.")).toBeInTheDocument();
		empty.unmount();
		notifier.emailEnabled = true;
		await services.subscribers.addWebhook(actor, {
			url: "https://hooks.example.com/a",
		});
		await services.subscribers.subscribe({ email: "pending@example.com" });
		render(await SubscribersPage(flash()));
		expect(
			screen.queryByText(/Email is not configured/),
		).not.toBeInTheDocument();
		expect(screen.getByText("Subscribers (2)")).toBeInTheDocument();
		expect(screen.getByText(/Webhook · Confirmed/)).toBeInTheDocument();
		expect(
			screen.getByText(/Email · Pending confirmation/),
		).toBeInTheDocument();
	});

	it("renders settings with the current theme selected", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		await services.settings.update(SYSTEM_ACTOR, {
			theme: "sunset",
			brandColor: "#123456",
		});
		render(await SettingsPage(flash()));
		expect(screen.getByDisplayValue("sunset")).toBeChecked();
		expect(screen.getByLabelText("Brand color")).toHaveValue("#123456");
		expect(
			screen.getByLabelText("Allow visitors to subscribe by email"),
		).toBeChecked();
	});

	it("renders the account page", async () => {
		const { app } = await setupApp();
		const { member } = await signIn(app, "viewer");
		render(await AccountPage(flash()));
		expect(
			screen.getByText(member.email, { selector: "dd" }),
		).toBeInTheDocument();
		expect(screen.getByText("Viewer", { selector: "dd" })).toBeInTheDocument();
		expect(
			screen.getAllByRole("button", { name: "Sign out" }).length,
		).toBeGreaterThan(0);
	});
});
