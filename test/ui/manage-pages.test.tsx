import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountPage from "@/app/manage/(portal)/account/page";
import AgentPage from "@/app/manage/(portal)/agents/[id]/page";
import AgentsLoading from "@/app/manage/(portal)/agents/loading";
import NewAgentPage from "@/app/manage/(portal)/agents/new/page";
import AgentsPage from "@/app/manage/(portal)/agents/page";
import DraftPage from "@/app/manage/(portal)/drafts/[id]/page";
import DraftsPage from "@/app/manage/(portal)/drafts/page";
import IncidentPage from "@/app/manage/(portal)/incidents/[id]/page";
import NewIncidentPage from "@/app/manage/(portal)/incidents/new/page";
import IncidentsPage from "@/app/manage/(portal)/incidents/page";
import PortalLayout from "@/app/manage/(portal)/layout";
import PortalLoading from "@/app/manage/(portal)/loading";
import MembersPage from "@/app/manage/(portal)/members/page";
import DashboardPage from "@/app/manage/(portal)/page";
import RegionsPage from "@/app/manage/(portal)/regions/page";
import ServicesPage from "@/app/manage/(portal)/services/page";
import BrandingPage from "@/app/manage/(portal)/settings/branding/page";
import NotificationsSettingsPage from "@/app/manage/(portal)/settings/notifications/page";
import SettingsPage from "@/app/manage/(portal)/settings/page";
import SubscribersPage from "@/app/manage/(portal)/subscribers/page";
import { createIncidentAction } from "@/app/manage/actions";
import AuthorizePage from "@/app/manage/authorize/page";
import InvitePage from "@/app/manage/invite/page";
import LoginPage from "@/app/manage/login/page";
import SetupPage from "@/app/manage/setup/page";
import { SESSION_COOKIE } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import { ICO_FAVICON, PNG_LOGO } from "../brand-asset-bytes";
import { agentActor } from "../helpers";
import {
	AGENT_REDIRECT,
	authorizationQuery,
	connectAgent,
	expectFlashRedirect,
	expectNotFound,
	flashQueryParams,
	params,
	redirectOf,
	setupApp,
	signIn,
} from "./app";
import { cookieJar, setPathname, setRequestHeaders } from "./next-state";

const flash = (value: Record<string, string> = {}) => ({
	searchParams: params(flashQueryParams(value)),
});

const rawFlash = (value: Record<string, string> = {}) => ({
	searchParams: params(value),
});

const AGENT = agentActor();

describe("login and setup", () => {
	it("sends visitors to setup until an admin exists", async () => {
		await setupApp();
		expect(await redirectOf(LoginPage(flash()))).toBe("/manage/setup");
		render(await SetupPage(flash({ error: "validation_failed" })));
		expect(
			screen.getByRole("heading", { name: "Create the first admin" }),
		).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Check the form and try again.",
		);
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
		render(await InvitePage(flash({ token, error: "validation_failed" })));
		expect(
			screen.getByRole("heading", { name: "Create your account" }),
		).toBeInTheDocument();
		expect(screen.getByText(/with the Viewer role/)).toBeInTheDocument();
		expect(screen.getByLabelText("Email")).toHaveValue("ed@acme.dev");
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Check the form and try again.",
		);
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
		await app.services.settings.updateBranding(
			SYSTEM_ACTOR,
			{},
			{ logo: { bytes: PNG_LOGO } },
		);
		const page = render(
			await LoginPage(flash({ error: "invalid_credentials" })),
		);
		expect(
			screen.getByRole("heading", { name: "Sign in" }),
		).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Invalid email or password",
		);
		expect(document.querySelector("img")).toHaveAttribute(
			"src",
			"/brand/logo?v=2026-11-02T12%3A00%3A00.000Z",
		);
		expect(
			screen.getByRole("link", { name: "Incident Command" }),
		).toHaveAttribute("href", "https://github.com/jaredwray/incident-command");
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

describe("agent consent page", () => {
	const consent = (query: Record<string, string | string[]>) =>
		AuthorizePage({ searchParams: params(query) });

	async function register(app: Awaited<ReturnType<typeof setupApp>>["app"]) {
		const { client_id } = await app.services.oauth.register({
			client_name: "Claude Code",
			redirect_uris: [AGENT_REDIRECT],
		});
		return authorizationQuery(client_id);
	}

	it("sends a visitor to sign in and back to the request", async () => {
		const { app } = await setupApp();
		const query = await register(app);
		const url = await redirectOf(consent(query));
		expect(url.startsWith("/manage/login?next=/manage/authorize?")).toBe(true);
		expect(url).toContain(`client_id=${query.client_id}`);
	});

	it("asks the member to allow the agent", async () => {
		const { app } = await setupApp();
		const query = await register(app);
		const { member } = await signIn(app, "editor");
		render(await consent({ ...query, error: "unavailable" }));
		expect(
			screen.getByRole("heading", { name: "Connect an agent" }),
		).toBeInTheDocument();
		expect(screen.getByText("Claude Code")).toBeInTheDocument();
		expect(
			screen.getByText(new RegExp(`signed in as ${member.email} \\(Editor\\)`)),
		).toBeInTheDocument();
		expect(screen.getByText("http://localhost:4567")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"The data store is unavailable",
		);
		const form = screen.getByRole("button", { name: "Allow" }).closest("form");
		expect(Object.fromEntries(new FormData(form as HTMLFormElement))).toEqual({
			...query,
			choice: "new",
			name: "Claude Code",
		});
		expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue(
			"Claude Code",
		);
		expect(screen.getByRole("textbox", { name: "Agent name" })).toBeRequired();
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
			"formnovalidate",
		);
	});

	it("offers a new agent or an agent the member already owns", async () => {
		const { app } = await setupApp();
		const first = await register(app);
		const { actor } = await signIn(app, "editor");
		const approved = await app.services.oauth.approve(
			actor,
			first,
			"http://localhost/api/mcp",
			{ name: "Existing" },
		);
		await app.services.oauth.token({
			grant_type: "authorization_code",
			client_id: first.client_id,
			code: new URL(approved).searchParams.get("code") ?? "",
			redirect_uri: AGENT_REDIRECT,
			code_verifier: "v".repeat(43),
		});
		const again = render(await consent(first));
		expect(screen.getByRole("radio", { name: "Existing agent" })).toBeChecked();
		expect(screen.getByRole("combobox")).toHaveValue(
			(await app.services.agents.list(actor))[0]?.id,
		);
		expect(
			screen.getByRole("option", {
				name: "Existing — Read status, Read drafts, Write drafts",
			}),
		).toBeInTheDocument();
		expect(
			screen.getByText(/A new agent can read the status page/),
		).toBeInTheDocument();
		again.unmount();
		const other = await register(app);
		const fresh = render(await consent(other));
		expect(screen.getByRole("radio", { name: "New agent" })).toBeChecked();
		fresh.unmount();
		await signIn(app, "admin");
		render(await consent(other));
		expect(
			screen.getByText(/You can attach this connection to any agent/),
		).toBeInTheDocument();
	});

	it("explains a request that it cannot send back to the agent", async () => {
		const { app } = await setupApp();
		const query = await register(app);
		await signIn(app, "editor");
		render(await consent({ ...query, client_id: [query.client_id, "x"] }));
		expect(
			screen.getByRole("heading", { name: "Cannot connect the agent" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/This agent is not registered/),
		).toBeInTheDocument();
	});

	it("does not send a visitor to the agent for a request that is not valid", async () => {
		const { app } = await setupApp();
		const query = await register(app);
		// Anybody can register a client, so an automatic redirect would let
		// any site use this page to send visitors to a different site.
		render(await consent({ ...query, code_challenge_method: "plain" }));
		expect(
			screen.getByRole("heading", { name: "Cannot connect the agent" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/PKCE with code_challenge_method S256 is required/),
		).toBeInTheDocument();
	});
});

describe("portal layout", () => {
	const page = <p>Page content</p>;

	it("shows the sections for the role and marks the section of the path", async () => {
		const { app, services } = await setupApp();
		await services.settings.update(SYSTEM_ACTOR, { siteName: "Acme Status" });
		const { member } = await signIn(app, "editor");
		render(await PortalLayout({ children: page }));
		const nav = within(screen.getByRole("navigation", { name: "Manage" }));
		expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(nav.getByRole("link", { name: "Incidents" })).not.toHaveAttribute(
			"aria-current",
		);
		expect(nav.queryByRole("link", { name: "Drafts" })).not.toBeInTheDocument();
		expect(
			nav.queryByRole("link", { name: "Members" }),
		).not.toBeInTheDocument();
		// Each member can connect their own agents.
		expect(nav.getByRole("link", { name: "Agents" })).toHaveAttribute(
			"href",
			"/manage/agents",
		);
		const statusPage = nav.getByRole("link", {
			name: "View status page (opens in a new tab)",
		});
		expect(statusPage).toHaveAttribute("href", "/");
		expect(statusPage).toHaveAttribute("target", "_blank");
		expect(statusPage).toHaveAttribute("rel", "noreferrer");
		expect(statusPage.querySelector("svg")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
		expect(screen.getByRole("link", { name: "Acme Status" })).toHaveAttribute(
			"href",
			"/manage",
		);
		expect(
			screen.getByRole("link", { name: "Incident Command" }),
		).toHaveAttribute("href", "https://github.com/jaredwray/incident-command");
		expect(
			nav.queryByRole("link", { name: "Account" }),
		).not.toBeInTheDocument();
		expect(
			nav.queryByRole("link", { name: "My Profile" }),
		).not.toBeInTheDocument();
		expect(screen.getByText(member.name)).toBeInTheDocument();
		expect(screen.getByText(`${member.email} · Editor`)).toBeInTheDocument();
		expect(
			screen.queryByRole("menuitem", { name: "My Profile" }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("main")).toHaveTextContent("Page content");
	});

	it("shows an uploaded logo beside the site name", async () => {
		const { app, services } = await setupApp();
		await services.settings.update(SYSTEM_ACTOR, { siteName: "Acme Status" });
		await services.settings.updateBranding(
			SYSTEM_ACTOR,
			{},
			{ logo: { bytes: PNG_LOGO } },
		);
		await signIn(app, "admin");
		render(await PortalLayout({ children: page }));
		const brand = screen.getByRole("link", { name: "Acme Status" });
		expect(brand.querySelector("img")).toHaveAttribute(
			"src",
			"/brand/logo?v=2026-11-02T12%3A00%3A00.000Z",
		);
	});

	it("keeps a section marked on the pages below it", async () => {
		const { app } = await setupApp();
		await signIn(app, "admin");
		setPathname("/manage/incidents/inc_1");
		render(await PortalLayout({ children: page }));
		const nav = within(screen.getByRole("navigation", { name: "Manage" }));
		expect(nav.getByRole("link", { name: "Incidents" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(nav.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
			"aria-current",
		);
		expect(nav.getByRole("link", { name: "Members" })).toBeInTheDocument();
		const hrefs = nav
			.getAllByRole("link")
			.map((link) => link.getAttribute("href"));
		expect(hrefs.at(-2)).toBe("/manage/settings");
		expect(hrefs.at(-1)).toBe("/");
	});

	it("opens My Profile from the user", async () => {
		const { app } = await setupApp();
		const { member } = await signIn(app, "editor");
		render(await PortalLayout({ children: page }));
		const user = screen.getByRole("button", { name: new RegExp(member.name) });
		expect(user).toHaveAttribute("aria-expanded", "false");

		fireEvent.click(user);
		expect(user).toHaveAttribute("aria-expanded", "true");
		const menu = screen.getByRole("menu", { name: "User" });
		const profile = within(menu).getByRole("menuitem", { name: "My Profile" });
		expect(profile).toHaveAttribute("href", "/manage/account");
		expect(profile).not.toHaveAttribute("aria-current");
		expect(
			within(menu).queryByRole("menuitem", { name: /status page/i }),
		).not.toBeInTheDocument();
		expect(
			within(menu).getByRole("menuitem", { name: "Sign out" }),
		).toBeInTheDocument();

		fireEvent.pointerDown(user);
		expect(screen.getByRole("menu", { name: "User" })).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Tab" });
		expect(screen.getByRole("menu", { name: "User" })).toBeInTheDocument();

		fireEvent.pointerDown(document.body);
		expect(
			screen.queryByRole("menu", { name: "User" }),
		).not.toBeInTheDocument();

		fireEvent.click(user);
		fireEvent.pointerDown(document);
		expect(
			screen.queryByRole("menu", { name: "User" }),
		).not.toBeInTheDocument();

		fireEvent.click(user);
		screen.getByRole("menuitem", { name: "My Profile" }).focus();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(
			screen.queryByRole("menu", { name: "User" }),
		).not.toBeInTheDocument();
		expect(user).toHaveFocus();

		fireEvent.click(user);
		fireEvent.click(screen.getByRole("menuitem", { name: "My Profile" }));
		expect(
			screen.queryByRole("menu", { name: "User" }),
		).not.toBeInTheDocument();
		fireEvent.click(user);
		expect(user).toHaveAttribute("aria-expanded", "true");
		fireEvent.click(user);
		expect(user).toHaveAttribute("aria-expanded", "false");
	});

	it("marks My Profile when that page is open", async () => {
		const { app } = await setupApp();
		const { member } = await signIn(app, "viewer");
		setPathname("/manage/account");
		render(await PortalLayout({ children: page }));
		const user = screen.getByRole("button", { name: new RegExp(member.name) });
		expect(user.className).toContain("bg-surface-muted");
		fireEvent.click(user);
		const profile = screen.getByRole("menuitem", { name: "My Profile" });
		expect(profile).toHaveAttribute("aria-current", "page");
		expect(profile.className).toContain("bg-surface-muted");
	});

	it("shows only the page to a visitor who is not signed in", async () => {
		await setupApp();
		render(await PortalLayout({ children: page }));
		expect(screen.getByText("Page content")).toBeInTheDocument();
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
	});

	it("shows a placeholder while a page loads", () => {
		render(<PortalLoading />);
		expect(screen.getByRole("status")).toHaveTextContent("Loading…");
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
		await services.drafts.create(AGENT, { title: "Fixed", message: "x" });
		render(await DashboardPage(flash({ notice: "welcome_admin" })));
		expect(screen.getByRole("status")).toHaveTextContent(
			"Welcome! Your admin account is ready.",
		);
		expect(
			screen.getByRole("link", { name: "Declare incident" }),
		).toHaveAttribute("href", "/manage/incidents/new");
		expect(
			screen.getAllByRole("link", { name: "API errors" })[0],
		).toHaveAttribute("href", expect.stringMatching(/^\/manage\/incidents\//));
		expect(
			within(screen.getByRole("region", { name: "Current status" })).getByText(
				"Major outage",
			),
		).toBeInTheDocument();
		expect(
			screen.getByRole("region", { name: "Services affected" }),
		).toHaveTextContent("1 / 1API");
		expect(
			screen.getByText("1 notification draft waits for review."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Review drafts →" }),
		).toHaveAttribute("href", "/manage/incidents");
		const row = screen.getByRole("row", { name: /^API/ });
		expect(row).toHaveTextContent("Major outage");
		// The service has no history before this instant.
		expect(within(row).getAllByText("No data")).toHaveLength(3);
		expect(
			screen.getByText("1 more than the previous 30 days"),
		).toBeInTheDocument();
		expect(screen.getByText("0 resolved")).toBeInTheDocument();
		expect(screen.getByText(/Open for < 1m/)).toBeInTheDocument();
	});

	it("shows uptime by service and the time to resolve incidents", async () => {
		const { app, clock, services } = await setupApp();
		clock.set("2026-08-01T00:00:00.000Z");
		const web = await services.catalog.create(SYSTEM_ACTOR, {
			name: "Web",
			group: "Frontend",
		});
		const outage = async (daysAgo: number) => {
			clock.set(
				new Date(
					Date.parse("2026-11-02T12:00:00.000Z") - daysAgo * 86_400_000,
				).toISOString(),
			);
			const incident = await services.incidents.create(SYSTEM_ACTOR, {
				title: `Outage ${daysAgo} days ago`,
				message: "x",
				impact: "minor",
				serviceIds: [web.id],
				notify: false,
			});
			clock.advance(30 * 60_000);
			await services.incidents.resolve(SYSTEM_ACTOR, incident.id);
		};
		for (const daysAgo of [31, 32, 33, 34, 35, 36, 37, 1, 2, 3, 4, 5, 6]) {
			await outage(daysAgo);
		}
		await services.drafts.create(AGENT, { title: "One", message: "x" });
		await services.drafts.create(AGENT, { title: "Two", message: "x" });
		clock.set("2026-11-02T12:00:00.000Z");
		await signIn(app, "viewer");
		render(await DashboardPage(flash()));
		expect(
			screen.getByText("2 notification drafts wait for review."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("region", { name: "Services affected" }),
		).toHaveTextContent("All services are operational");
		const row = screen.getByRole("row", { name: /^WebFrontend/ });
		expect(row).toHaveTextContent("Operational");
		expect(within(row).getAllByText("100%")).toHaveLength(3);
		expect(screen.getByRole("region", { name: "Uptime" })).toHaveTextContent(
			"100%Last 90 days",
		);
		expect(
			screen.getByText("1 fewer than the previous 30 days"),
		).toBeInTheDocument();
		expect(screen.getByText("6 resolved")).toBeInTheDocument();
		expect(screen.getAllByText("30m")).toHaveLength(2);
		expect(
			screen.getByRole("link", { name: "Outage 1 days ago" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Outage 6 days ago" }),
		).not.toBeInTheDocument();
		expect(screen.getAllByText(/Resolved in 30m/)).toHaveLength(5);
		expect(screen.getByText("Showing 5 of 6 incidents.")).toBeInTheDocument();
	});

	it("shows an empty state and store outages", async () => {
		const { app } = await setupApp();
		await signIn(app, "admin");
		vi.spyOn(app.store, "health", "get").mockReturnValue({
			online: false,
			kind: "memory",
			lastError: "connection refused",
		});
		render(await DashboardPage(flash()));
		expect(screen.getByText("Nothing open. All quiet.")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"The database is unreachable (connection refused)",
		);
		expect(screen.getByText(/No services yet/)).toBeInTheDocument();
		expect(screen.queryByText(/wait for review/)).not.toBeInTheDocument();
		expect(
			screen.getByText("Same as the previous 30 days"),
		).toBeInTheDocument();
		expect(screen.getAllByText("None")).toHaveLength(2);
		expect(
			screen.getByText("No incidents in the last 30 days."),
		).toBeInTheDocument();
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
		expectFlashRedirect(
			await redirectOf(MembersPage(flash())),
			"/manage",
			"error",
			"That page requires the admin role",
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
		const removed = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Removed one",
			message: "x",
			notify: false,
		});
		await services.incidents.delete(SYSTEM_ACTOR, removed.id, {
			reason: "Duplicate report",
		});
		render(await IncidentsPage(flash()));
		expect(screen.getByRole("link", { name: "Open one" })).toBeInTheDocument();
		expect(screen.getByText(/2 posts/)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Closed one" }),
		).toBeInTheDocument();
		expect(screen.getAllByText(/Maintenance ·/)).toHaveLength(1);
		expect(
			screen.getByRole("link", { name: "Schedule maintenance" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Deleted" }),
		).toBeInTheDocument();
		expect(screen.getByText(/Deleted by System/)).toBeInTheDocument();
		expect(screen.getByText("Reason: Duplicate report")).toBeInTheDocument();
		expect(
			screen
				.getAllByRole("link", { name: "Removed one" })
				.map((link) => link.getAttribute("href")),
		).toEqual([`/manage/incidents/${removed.id}`]);
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
			screen.queryByRole("heading", { name: "Drafts" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Deleted" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Declare incident" }),
		).not.toBeInTheDocument();
	});

	it("renders the new incident and maintenance forms", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const page = render(
			await NewIncidentPage(flash({ error: "validation_failed" })),
		);
		expect(
			screen.getByRole("heading", { name: "Declare an incident" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Impact")).toBeInTheDocument();
		expect(screen.getByText("No services yet.")).toBeInTheDocument();
		expect(screen.queryByLabelText("Region")).not.toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Check the form and try again.",
		);
		page.unmount();

		const api = await services.catalog.create(SYSTEM_ACTOR, {
			name: "API",
			group: "Core",
		});
		const maintenance = render(
			await NewIncidentPage(flash({ kind: "maintenance" })),
		);
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
		// Like the status for all services, a status for each service is for incidents only.
		expect(
			screen.queryByRole("combobox", { name: "Status of API" }),
		).not.toBeInTheDocument();
		maintenance.unmount();

		render(await NewIncidentPage(flash()));
		const own = screen.getByRole("combobox", { name: "Status of API" });
		expect(own).toHaveValue("");
		// A status of a service that is not selected has no effect, also when no service is selected.
		fireEvent.change(screen.getByLabelText("Incident Title"), {
			target: { value: "Errors" },
		});
		fireEvent.change(screen.getByLabelText("Message"), {
			target: { value: "Looking" },
		});
		fireEvent.change(own, { target: { value: "major_outage" } });
		const declared = await redirectOf(
			createIncidentAction(
				new FormData(own.closest("form") as HTMLFormElement),
			),
		);
		expect(declared).toContain("notice=incident_declared");
		const [incident] = await services.incidents.list();
		expect(incident?.serviceIds).toEqual([]);
		expect((await services.catalog.get(api.id)).status).toBe("operational");
	});

	it("renders incident management for editors", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const web = await services.catalog.create(SYSTEM_ACTOR, { name: "Web" });
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "Looking",
			serviceIds: [api.id],
		});
		const dashboard = render(
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
		expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}?tab=timeline`,
		);
		expect(screen.getByRole("link", { name: "Posts" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}?tab=posts`,
		);
		expect(
			screen.getByRole("heading", { name: "Status of the affected services" }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Create a post" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}?post=1`,
		);
		expect(
			screen.queryByRole("button", { name: "Post update" }),
		).not.toBeInTheDocument();
		expect(screen.getByText("Looking")).toBeInTheDocument();
		expect(
			screen.getByText("System posted this and chose to notify subscribers."),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Drafts" }),
		).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Incident Title")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Save details" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Save region" }),
		).not.toBeInTheDocument();
		const banner = screen.getByRole("region", { name: "Delete this incident" });
		expect(
			within(banner).getByText(
				"Be very careful. Delete an incident only when customers must not see it.",
			),
		).toBeInTheDocument();
		expect(
			within(banner).getByText(
				/The status page, the history, the RSS feed, the API, and the agents hide it/,
			),
		).toBeInTheDocument();
		expect(
			within(banner).getByRole("button", { name: "Delete incident" }),
		).toBeInTheDocument();
		const postsHeading = screen.getByRole("heading", { name: "Posts" });
		expect(
			postsHeading.compareDocumentPosition(banner) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		dashboard.unmount();

		// The update form sets a status for each affected service and can add another.
		const form = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ post: "1" }),
			}),
		);
		const updateForm = screen
			.getByRole("button", { name: "Post update" })
			.closest("form") as HTMLElement;
		const own = within(updateForm).getByRole("combobox", {
			name: "Status of API",
		});
		expect(within(updateForm).getByLabelText("Incident Title")).toHaveValue(
			"API errors",
		);
		expect(within(updateForm).getByLabelText("Impact")).toHaveValue("minor");
		expect(own).toHaveAttribute("name", `serviceStatus:${api.id}`);
		expect(own).toHaveValue("");
		expect(
			within(updateForm).getByText("Now: Degraded performance"),
		).toBeInTheDocument();
		expect(
			within(updateForm).getByRole("checkbox", { name: /Web/ }),
		).not.toBeChecked();
		expect(
			within(updateForm).getByRole("combobox", { name: "Status of Web" }),
		).toHaveValue("");
		expect(
			within(updateForm).getByText("Now: Operational"),
		).toBeInTheDocument();
		expect(
			within(updateForm).queryByRole("checkbox", { name: /API/ }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Post update" }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}`,
		);
		expect(
			screen.queryByRole("link", { name: "Create a post" }),
		).not.toBeInTheDocument();
		form.unmount();

		await services.incidents.postUpdate(SYSTEM_ACTOR, incident.id, {
			title: "API outage",
			impact: "critical",
			message: "Worse",
			notify: false,
		});

		const covered = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Both",
			message: "x",
			serviceIds: [api.id, web.id],
			notify: false,
		});
		const coveredPage = render(
			await IncidentPage({
				params: params({ id: covered.id }),
				searchParams: params({ post: "1" }),
			}),
		);
		const fullForm = screen
			.getByRole("button", { name: "Post update" })
			.closest("form") as HTMLElement;
		expect(
			within(fullForm).getByText("Every service is on this incident."),
		).toBeInTheDocument();
		coveredPage.unmount();

		const timeline = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ tab: "timeline" }),
			}),
		);
		expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "API outage" }),
		).toBeInTheDocument();
		expect(screen.getByText("API errors")).toBeInTheDocument();
		expect(screen.getAllByText("API outage").length).toBeGreaterThan(1);
		expect(screen.getAllByText(/System \(system\)/).length).toBeGreaterThan(1);
		expect(screen.getByText("Looking")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Delete incident" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("region", { name: "Delete this incident" }),
		).not.toBeInTheDocument();
		timeline.unmount();

		const posts = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ tab: "posts" }),
			}),
		);
		expect(screen.getByRole("link", { name: "Posts" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "Create a post" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}?tab=posts&post=1`,
		);
		expect(
			screen.queryByRole("button", { name: "Delete incident" }),
		).not.toBeInTheDocument();
		const items = screen.getAllByRole("listitem");
		const newest = items[0]?.textContent ?? "";
		expect(newest.indexOf("Investigating")).toBeLessThan(
			newest.indexOf("Critical impact"),
		);
		expect(newest.indexOf("Critical impact")).toBeLessThan(
			newest.indexOf("API outage"),
		);
		expect(newest.indexOf("API outage")).toBeLessThan(newest.indexOf("Worse"));
		expect(
			within(items[0] as HTMLElement).queryByText("Minor impact"),
		).not.toBeInTheDocument();
		expect(
			within(items[1] as HTMLElement).getByText("API errors"),
		).toBeInTheDocument();
		expect(
			within(items[1] as HTMLElement).getByText("Minor impact"),
		).toBeInTheDocument();
		expect(
			within(items[1] as HTMLElement).getByText("Looking"),
		).toBeInTheDocument();
		posts.unmount();

		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ tab: "posts", post: "1" }),
			}),
		);
		const postsForm = screen
			.getByRole("button", { name: "Post update" })
			.closest("form") as HTMLElement;
		expect(postsForm.querySelector('input[name="tab"]')).toHaveValue("posts");
		expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}?tab=posts`,
		);
		expect(
			screen.queryByRole("link", { name: "Create a post" }),
		).not.toBeInTheDocument();
	});

	it("shows pending drafts and who approved each post", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "editor");
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "Looking",
			serviceIds: [api.id],
		});
		await services.incidents.postUpdate(actor, incident.id, {
			message: "Quiet note",
			notify: false,
		});
		await services.incidents.postUpdate(actor, incident.id, {
			message: "Legacy",
		});
		const stored = await services.incidents.get(incident.id);
		const legacy = stored.updates.find((update) => update.message === "Legacy");
		delete legacy?.notified;
		await app.store.update("incidents", stored);
		const agentDraft = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "Agent note",
		});
		await services.drafts.approve(actor, agentDraft.id, agentDraft.content);
		const ownDraft = await services.drafts.create(actor, {
			incidentId: incident.id,
			message: "Own note",
		});
		await services.drafts.approve(actor, ownDraft.id, ownDraft.content);
		await services.incidents.postUpdate(actor, incident.id, {
			message: "Sixth",
		});
		const pending = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "Please review this.",
		});
		const discarded = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "Drop this.",
		});
		await services.drafts.discard(actor, discarded.id);

		const dashboard = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(
			screen.getByText("These are the latest 5 of 6 posts."),
		).toBeInTheDocument();
		expect(screen.queryByText("Looking")).not.toBeInTheDocument();
		expect(screen.getByText("Sixth")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /^Please review this/ }),
		).toHaveAttribute("href", `/manage/drafts/${pending.id}`);
		expect(screen.queryByText("Drop this.")).not.toBeInTheDocument();
		dashboard.unmount();

		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ tab: "posts" }),
			}),
		);
		expect(screen.getByRole("link", { name: "Posts" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByText("Looking")).toBeInTheDocument();
		expect(
			screen.getByText("System posted this and chose to notify subscribers."),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Editor User posted this and chose not to notify subscribers.",
			),
		).toBeInTheDocument();
		expect(screen.getByText("Editor User posted this.")).toBeInTheDocument();
		expect(
			screen.getByText(
				"Test agent wrote this post. Editor User approved this post and chose to notify subscribers.",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Editor User approved this post and chose to notify subscribers.",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Editor User posted this and chose to notify subscribers.",
			),
		).toBeInTheDocument();
		expect(
			screen.queryByText("These are the latest 5 of 6 posts."),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Drafts" }),
		).not.toBeInTheDocument();
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
		expect(
			screen.getByRole("button", { name: "Save window" }),
		).toBeInTheDocument();
		expect(screen.queryByLabelText("Impact")).not.toBeInTheDocument();
		expect(screen.queryByText("None impact")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("heading", {
				name: "Status of the affected services",
			}),
		).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(
			screen.getByRole("region", { name: "Delete this incident" }),
		).toBeInTheDocument();
		editor.unmount();

		const timeline = render(
			await IncidentPage({
				params: params({ id: maintenance.id }),
				searchParams: params({ tab: "timeline" }),
			}),
		);
		expect(
			screen.queryByRole("button", { name: "Save window" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Delete incident" }),
		).not.toBeInTheDocument();
		timeline.unmount();

		// Maintenance with no services has no status for each service.
		const form = render(
			await IncidentPage({
				params: params({ id: maintenance.id }),
				searchParams: params({ post: "1" }),
			}),
		);
		expect(
			screen.getByRole("button", { name: "Post update" }),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Status of each service"),
		).not.toBeInTheDocument();
		expect(screen.getByLabelText("Incident Title")).toHaveValue("Upgrade");
		expect(screen.queryByLabelText("Impact")).not.toBeInTheDocument();
		form.unmount();

		const { app: viewerApp, services: viewerServices } = await setupApp();
		await signIn(viewerApp, "viewer");
		const incident = await viewerServices.incidents.create(SYSTEM_ACTOR, {
			title: "Read only",
			message: "x",
		});
		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ post: "1" }),
			}),
		);
		expect(
			screen.queryByRole("button", { name: "Post update" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Create a post" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Delete incident" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByText("System posted this and chose to notify subscribers."),
		).toBeInTheDocument();
	});

	it("shows a region on the incident forms", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const region = await services.regions.create(SYSTEM_ACTOR, {
			name: "United States",
		});
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "US down",
			message: "Down",
			serviceIds: [api.id],
			serviceRegions: [{ serviceId: api.id, regionIds: [region.id] }],
		});
		const list = render(await IncidentsPage(flash()));
		expect(screen.getByText(/United States/)).toBeInTheDocument();
		list.unmount();
		const created = render(await NewIncidentPage(flash()));
		expect(
			screen.getByRole("checkbox", { name: "United States" }),
		).not.toBeChecked();
		created.unmount();
		const incidentPage = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(screen.getAllByText("United States").length).toBeGreaterThan(0);
		expect(
			screen.getByRole("checkbox", { name: "United States" }),
		).toBeChecked();
		expect(
			screen.getByRole("button", { name: "Save regions" }),
		).toBeInTheDocument();
		incidentPage.unmount();
		const posts = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ tab: "posts" }),
			}),
		);
		expect(
			screen.queryByRole("button", { name: "Save regions" }),
		).not.toBeInTheDocument();
		posts.unmount();
		await services.catalog.delete(SYSTEM_ACTOR, api.id);
		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(screen.getByText(api.id)).toBeInTheDocument();
		expect(
			screen.getByRole("checkbox", { name: "United States" }),
		).toBeChecked();
	});

	it("asks for a reason before it deletes an incident", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "Looking",
			notify: false,
		});
		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({}),
			}),
		);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Delete incident" }));
		const dialog = screen.getByRole("dialog", {
			name: "Delete this incident from the public view",
		});
		expect(
			within(dialog).getByText(
				"This action removes the incident from the public view only. The portal keeps the incident and its posts.",
			),
		).toBeInTheDocument();
		expect(
			within(dialog).getByText(
				"The portal records who deleted the incident and why. A member can read that record later.",
			),
		).toBeInTheDocument();
		const reason = within(dialog).getByLabelText("Reason");
		expect(reason).toBeRequired();
		expect(reason).toHaveAttribute("maxlength", "1000");
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Delete incident" }));
		const open = screen.getByRole("dialog", {
			name: "Delete this incident from the public view",
		});
		await user.type(within(open).getByLabelText("Reason"), "Duplicate report");
		const close = vi.spyOn(HTMLDialogElement.prototype, "close");
		const url = await redirectOf(
			act(async () => {
				await user.click(
					within(open).getByRole("button", {
						name: "Delete from the public view",
					}),
				);
			}),
		);
		expect(url).toContain("notice=incident_deleted");
		expect(close).toHaveBeenCalled();
		close.mockRestore();
		const kept = await services.incidents.find(incident.id, {
			includeDeleted: true,
		});
		expect(kept).toMatchObject({
			deletedReason: "Duplicate report",
			deletedBy: { name: "Editor User" },
		});
	});

	it("shows the deletion record and no edit controls", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "editor");
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "Looking",
			notify: false,
		});
		await services.incidents.delete(actor, incident.id, {
			reason: "Duplicate report",
		});
		const page = render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ post: "1" }),
			}),
		);
		expect(
			screen.getByRole("region", { name: "Deleted from the public view" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Editor User deleted this incident on/),
		).toBeInTheDocument();
		expect(screen.getByText("Reason: Duplicate report")).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "View public page" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Create a post" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Delete incident" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Post update" }),
		).not.toBeInTheDocument();
		expect(screen.getByText("Looking")).toBeInTheDocument();
		page.unmount();

		render(
			await IncidentPage({
				params: params({ id: incident.id }),
				searchParams: params({ tab: "timeline" }),
			}),
		);
		expect(screen.getByText("Looking")).toBeInTheDocument();
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

	it("lists pending drafts under open incidents", async () => {
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
		await services.incidents.delete(SYSTEM_ACTOR, orphan.id, {
			reason: "Duplicate",
		});
		const discarded = await services.drafts.create(AGENT, {
			kind: "maintenance",
			title: "Upgrade",
			message: "x",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		await services.drafts.discard(actor, discarded.id);

		render(await IncidentsPage(flash({ notice: "draft_discarded" })));
		expect(screen.getByRole("status")).toHaveTextContent("Draft discarded");
		expect(screen.getByRole("link", { name: /^API errors/ })).toHaveAttribute(
			"href",
			`/manage/drafts/${created.id}`,
		);
		expect(
			screen
				.getAllByRole("link", { name: /^Database slow/ })
				.map((link) => link.getAttribute("href")),
		).toEqual(
			expect.arrayContaining([
				`/manage/incidents/${incident.id}`,
				`/manage/drafts/${update.id}`,
			]),
		);
		expect(
			screen.getByRole("link", { name: /^Deleted incident/ }),
		).toBeInTheDocument();
		expect(
			screen.getAllByText(/New incident · Drafted by Test agent/),
		).toHaveLength(1);
		expect(screen.getAllByText(/Incident update · Drafted by/)).toHaveLength(2);
		expect(screen.getAllByText("Review")).toHaveLength(3);
		expect(
			screen.queryByText("Discarded by Editor User"),
		).not.toBeInTheDocument();
		expect(screen.queryByText(/New maintenance/)).not.toBeInTheDocument();
		expect(
			screen.getByText(
				"These drafts wait for review. An editor approves a draft before the status page shows it.",
			),
		).toBeInTheDocument();
	});

	it("sends the old drafts list to the incidents page", async () => {
		await setupApp();
		expect(await redirectOf(DraftsPage())).toBe("/manage/incidents");
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
			serviceStatuses: [{ serviceId: api.id, status: "major_outage" }],
		});
		render(await draftPage(draft.id));
		expect(
			screen.getByRole("heading", { level: 1, name: "API errors" }),
		).toBeInTheDocument();
		expect(screen.getByText(/This draft waits for review/)).toBeInTheDocument();
		expect(screen.getByLabelText("Incident Title")).toHaveValue("API errors");
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
		expect(screen.getByRole("combobox", { name: "Status of API" })).toHaveValue(
			"major_outage",
		);
		expect(screen.getByRole("combobox", { name: "Status of Web" })).toHaveValue(
			"",
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

		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const web = await services.catalog.create(SYSTEM_ACTOR, { name: "Web" });
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "x",
			status: "identified",
			serviceIds: [api.id],
			notify: false,
		});
		const update = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "A fix is ready.",
			serviceIds: [web.id],
			serviceStatuses: [
				{ serviceId: api.id, status: "partial_outage" },
				{ serviceId: web.id, status: "major_outage" },
			],
		});
		const updatePage = render(await draftPage(update.id));
		expect(
			screen.getByRole("heading", { level: 1, name: "API errors" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Incident update · Drafted by Test agent/),
		).toBeInTheDocument();
		// An update without a status keeps the status that the incident has at approval.
		expect(screen.getByLabelText("Status")).toHaveValue("");
		expect(
			screen.getByRole("option", { name: "Keep current status (Identified)" }),
		).toHaveValue("");
		expect(screen.getByLabelText("Incident Title")).toHaveValue("API errors");
		expect(screen.getByLabelText("Impact")).toHaveValue("minor");
		expect(screen.queryByText("Affected services")).not.toBeInTheDocument();
		expect(screen.getByText("Add a service")).toBeInTheDocument();
		// An update offers a status for each affected service, and for a service to add.
		expect(screen.getByRole("combobox", { name: "Status of API" })).toHaveValue(
			"partial_outage",
		);
		expect(screen.getByRole("checkbox", { name: /Web/ })).toBeChecked();
		expect(screen.getByRole("combobox", { name: "Status of Web" })).toHaveValue(
			"major_outage",
		);
		expect(
			screen.queryByRole("checkbox", { name: /API/ }),
		).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "View incident" })).toHaveAttribute(
			"href",
			`/manage/incidents/${incident.id}`,
		);
		updatePage.unmount();

		const named = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "The title changes.",
			title: "API outage",
			impact: "critical",
		});
		const namedPage = render(await draftPage(named.id));
		expect(screen.getByLabelText("Incident Title")).toHaveValue("API outage");
		expect(screen.getByLabelText("Impact")).toHaveValue("critical");
		namedPage.unmount();

		const planned = await services.incidents.create(SYSTEM_ACTOR, {
			kind: "maintenance",
			title: "Database upgrade",
			message: "x",
			scheduledStart: "2026-11-05T02:00:00.000Z",
			scheduledEnd: "2026-11-05T03:00:00.000Z",
			notify: false,
		});
		const maintenanceUpdate = await services.drafts.create(AGENT, {
			incidentId: planned.id,
			message: "Still on track.",
		});
		const maintenanceReview = render(await draftPage(maintenanceUpdate.id));
		expect(screen.getByLabelText("Incident Title")).toHaveValue(
			"Database upgrade",
		);
		expect(screen.queryByLabelText("Impact")).not.toBeInTheDocument();
		maintenanceReview.unmount();
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
			serviceStatuses: [{ serviceId: api.id, status: "partial_outage" }],
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
			"API: Partial outage",
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

		const web = await services.catalog.create(SYSTEM_ACTOR, { name: "Web" });
		const update = await services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "Nothing to add.",
			serviceIds: [web.id],
		});
		await services.drafts.discard(actor, update.id);
		render(await draftPage(update.id));
		expect(
			screen.getByText(
				/Discarded by Editor User .*Nothing was published or sent/,
			),
		).toBeInTheDocument();
		expect(screen.getByText("Nothing to add.")).toBeInTheDocument();
		expect(screen.getByText("Services to add")).toBeInTheDocument();
		expect(screen.getByText("Web")).toBeInTheDocument();
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
		await services.incidents.delete(SYSTEM_ACTOR, incident.id, {
			reason: "Duplicate",
		});
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

	it("shows the region of a draft", async () => {
		const { app, services } = await setupApp();
		const region = await services.regions.create(SYSTEM_ACTOR, {
			name: "United States",
		});
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const web = await services.catalog.create(SYSTEM_ACTOR, { name: "Web" });
		const withRegion = await services.drafts.create(AGENT, {
			title: "US errors",
			message: "Looking",
			serviceIds: [api.id, web.id],
			serviceRegions: [{ serviceId: api.id, regionIds: [region.id] }],
		});
		const global = await services.drafts.create(AGENT, {
			title: "Global errors",
			message: "Looking",
		});
		await signIn(app, "editor");
		const editor = render(await draftPage(withRegion.id));
		const checked = screen
			.getAllByRole("checkbox", { name: "United States" })
			.filter((box) => (box as HTMLInputElement).checked);
		expect(checked).toHaveLength(1);
		editor.unmount();
		await signIn(app, "viewer");
		const named = render(await draftPage(withRegion.id));
		expect(screen.getByText("Global, United States")).toBeInTheDocument();
		named.unmount();
		const stored = await services.drafts.get(withRegion.id);
		const { serviceRegions: _regions, ...rest } = stored.content;
		await app.store.update("notification_drafts", {
			...stored,
			content: {
				...rest,
				serviceIds: [api.id],
				regionId: region.id,
			} as typeof stored.content,
		});
		await signIn(app, "editor");
		const legacy = render(await draftPage(withRegion.id));
		const legacyChecked = screen
			.getAllByRole("checkbox", { name: "United States" })
			.filter((box) => (box as HTMLInputElement).checked);
		expect(legacyChecked).toHaveLength(1);
		legacy.unmount();
		const live = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Live",
			message: "x",
			serviceIds: [api.id],
			serviceRegions: [{ serviceId: api.id, regionIds: [region.id] }],
		});
		const update = await services.drafts.create(AGENT, {
			incidentId: live.id,
			message: "Now in the US",
			serviceRegions: [{ serviceId: api.id, regionIds: [region.id] }],
		});
		const review = render(await draftPage(update.id));
		const reviewChecked = screen
			.getAllByRole("checkbox", { name: "United States" })
			.filter((box) => (box as HTMLInputElement).checked);
		expect(reviewChecked).toHaveLength(1);
		expect(reviewChecked[0]).toHaveAttribute("name", `regionIds:${api.id}`);
		expect(document.querySelector(`input[name="boundServiceIds"]`)).toHaveValue(
			api.id,
		);
		review.unmount();
		render(await draftPage(global.id));
		expect(
			screen.queryByText("Region", { selector: "dt" }),
		).not.toBeInTheDocument();
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

describe("regions page", () => {
	it("lets editors manage regions", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "editor");
		const region = await services.regions.create(SYSTEM_ACTOR, {
			name: "United States",
		});
		render(await RegionsPage(flash()));
		expect(screen.getByDisplayValue("United States")).toBeInTheDocument();
		expect(screen.getByDisplayValue(String(region.order))).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Add region" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
	});

	it("is read-only for viewers", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "viewer");
		const empty = render(await RegionsPage(flash()));
		expect(
			screen.getByText("No regions yet. The status page stays one page."),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Add region" }),
		).not.toBeInTheDocument();
		empty.unmount();
		await services.regions.create(SYSTEM_ACTOR, { name: "Europe" });
		render(await RegionsPage(flash()));
		expect(screen.getByText("Europe")).toBeInTheDocument();
		expect(screen.getByText("order 0")).toBeInTheDocument();
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

	it("ignores unsigned notice query values", async () => {
		const { app } = await setupApp();
		await signIn(app, "admin");
		render(await MembersPage(rawFlash({ notice: "Member removed you suck" })));
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		render(await MembersPage(flash({ notice: "member_removed" })));
		expect(screen.getByRole("status")).toHaveTextContent("Member removed");
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

	it("shows the endpoint, connected agents and API tokens", async () => {
		const { app, services, clock } = await setupApp();
		const { actor } = await signIn(app, "admin");
		setRequestHeaders({
			host: "status.acme.dev",
			"x-forwarded-proto": "https",
		});
		const endpoint = "https://status.acme.dev/api/mcp";
		const empty = render(await AgentsPage(flash()));
		const banner = within(screen.getByRole("region", { name: "MCP endpoint" }));
		expect(banner.getByText(endpoint)).toBeInTheDocument();
		expect(banner.getByRole("button", { name: "Copy" })).toBeInTheDocument();
		expect(
			screen.getByText(
				`claude mcp add --transport http incident-command ${endpoint} --header "Authorization: Bearer <token>"`,
			),
		).toBeInTheDocument();
		expect(screen.getByText("No agents yet.")).toBeInTheDocument();
		expect(screen.getByText("No activity yet.")).toBeInTheDocument();
		empty.unmount();

		const editor = await signIn(app, "editor");
		await signIn(app, "admin").then(({ actor: admin }) =>
			connectAgent(app, admin, "Claude Code"),
		);
		await connectAgent(app, editor.actor, "Cursor");
		const usedAgent = await services.agents.create(actor, {
			name: "Used bot",
			description: "Pager bridge",
		});
		const used = await services.agents.createToken(actor, usedAgent.id, {
			expiresInDays: 30,
		});
		await services.agents.authenticate(used.token);
		const revokedAgent = await services.agents.create(actor, {
			name: "Revoked bot",
		});
		const revoked = await services.agents.createToken(
			actor,
			revokedAgent.id,
			{},
		);
		await services.agents.revokeToken(actor, revoked.credentialId);
		const expiredAgent = await services.agents.create(actor, {
			name: "Expired bot",
		});
		await services.agents.createToken(actor, expiredAgent.id, {
			expiresInDays: 1,
		});
		clock.advance(2 * 86_400_000);
		vi.useFakeTimers({ now: clock.current, toFake: ["Date"] });
		render(await AgentsPage(flash()));
		vi.useRealTimers();
		expect(screen.getByText("Claude Code")).toBeInTheDocument();
		expect(screen.getByText("Cursor")).toBeInTheDocument();
		expect(screen.getByText(/OAuth: Editor User/)).toBeInTheDocument();
		expect(screen.getByText(/OAuth: Admin User/)).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(
			2,
		);
		expect(screen.getByText("Pager bridge")).toBeInTheDocument();
		expect(screen.getByText("active")).toBeInTheDocument();
		expect(screen.getByText("revoked")).toBeInTheDocument();
		expect(screen.getByText("expired")).toBeInTheDocument();
		expect(screen.getAllByText(/Never used/)).toHaveLength(4);
		expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
	});

	it("shows a member only their own agents and no API tokens", async () => {
		const { app } = await setupApp();
		const admin = await signIn(app, "admin");
		const editor = await signIn(app, "editor");
		await connectAgent(app, admin.actor, "Admin agent");
		await connectAgent(app, editor.actor, "Editor agent");
		const [owned] = await app.services.agents.list(editor.actor);
		const { client_id } = await app.services.oauth.register({
			client_name: "Extra",
			redirect_uris: [AGENT_REDIRECT],
		});
		const url = await app.services.oauth.approve(
			admin.actor,
			authorizationQuery(client_id),
			"http://localhost/api/mcp",
			{ agentId: owned?.id ?? "" },
		);
		await app.services.oauth.token({
			grant_type: "authorization_code",
			client_id,
			code: new URL(url).searchParams.get("code") ?? "",
			redirect_uri: AGENT_REDIRECT,
			code_verifier: "v".repeat(43),
		});
		render(await AgentsPage(flash()));
		expect(screen.getByText("Editor agent")).toBeInTheDocument();
		expect(screen.queryByText("Admin agent")).not.toBeInTheDocument();
		expect(screen.getByText(/OAuth: Admin User/)).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "New agent" }),
		).not.toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(
			1,
		);
	});

	it("shows agent settings, credentials and activity", async () => {
		const { app, services, clock } = await setupApp();
		const admin = await signIn(app, "admin");
		const agent = await services.agents.create(admin.actor, {
			name: "Ops bot",
			description: "Bridge",
			permissions: [],
		});
		const created = render(await NewAgentPage(flash()));
		expect(screen.getByRole("checkbox", { name: /Read status/ })).toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: /Notify subscribers/ }),
		).not.toBeChecked();
		created.unmount();
		const list = render(await AgentsPage(flash()));
		expect(screen.getByText(/No permissions/)).toBeInTheDocument();
		list.unmount();
		const bare = render(
			await AgentPage({
				params: params({ id: agent.id }),
				searchParams: params({}),
			}),
		);
		expect(screen.getByText("No credentials yet.")).toBeInTheDocument();
		bare.unmount();

		const { client_id } = await app.services.oauth.register({
			client_name: "Portal",
			redirect_uris: [AGENT_REDIRECT],
		});
		const approved = await app.services.oauth.approve(
			admin.actor,
			authorizationQuery(client_id),
			"http://localhost/api/mcp",
			{ agentId: agent.id },
		);
		await app.services.oauth.token({
			grant_type: "authorization_code",
			client_id,
			code: new URL(approved).searchParams.get("code") ?? "",
			redirect_uri: AGENT_REDIRECT,
			code_verifier: "v".repeat(43),
		});
		const active = await services.agents.createToken(admin.actor, agent.id, {
			expiresInDays: 7,
		});
		await services.agents.authenticate(active.token);
		const revoked = await services.agents.createToken(
			admin.actor,
			agent.id,
			{},
		);
		await services.agents.revokeToken(admin.actor, revoked.credentialId);
		await services.agents.createToken(admin.actor, agent.id, {
			expiresInDays: 1,
		});
		clock.advance(2 * 86_400_000);
		const page = (id: string, query: Record<string, string> = {}) =>
			AgentPage({
				params: params({ id }),
				searchParams: params(query),
			});
		const detail = render(await page(agent.id));
		expect(screen.getByText("active")).toBeInTheDocument();
		expect(screen.getByText("revoked")).toBeInTheDocument();
		expect(screen.getByText("expired")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Create token" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
		expect(screen.getByText("Created the agent.")).toBeInTheDocument();
		expect(screen.getAllByText(/Expires/).length).toBeGreaterThan(0);
		detail.unmount();

		for (let index = 0; index < 49; index += 1) {
			await services.activity.record({
				agentId: agent.id,
				type: "agent_renamed",
				actor: { type: "member", id: admin.actor.id, name: admin.actor.name },
				outcome: "ok",
			});
		}
		const listed = render(await page(agent.id));
		expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
			"href",
			`/manage/agents/${agent.id}?page=2`,
		);
		listed.unmount();
		render(await page(agent.id, { page: "2" }));
		expect(
			screen.queryByRole("link", { name: "Next" }),
		).not.toBeInTheDocument();

		await expectNotFound(page("agt_missing"));
		vi.spyOn(services.agents, "get").mockRejectedValueOnce(new Error("kaput"));
		await expect(page(agent.id)).rejects.toThrow("kaput");
	});

	it("lets an owner rename an agent and hides credentials they cannot change", async () => {
		const { app, services } = await setupApp();
		const admin = await signIn(app, "admin");
		const editor = await signIn(app, "editor");
		await connectAgent(app, editor.actor, "Editor agent");
		const [owned] = await services.agents.list(editor.actor);
		const { client_id } = await app.services.oauth.register({
			client_name: "Extra",
			redirect_uris: [AGENT_REDIRECT],
		});
		const url = await app.services.oauth.approve(
			admin.actor,
			authorizationQuery(client_id),
			"http://localhost/api/mcp",
			{ agentId: owned?.id ?? "" },
		);
		await app.services.oauth.token({
			grant_type: "authorization_code",
			client_id,
			code: new URL(url).searchParams.get("code") ?? "",
			redirect_uri: AGENT_REDIRECT,
			code_verifier: "v".repeat(43),
		});
		const { token } = await app.services.sessions.create(editor.member.id);
		cookieJar.set(SESSION_COOKIE, token);
		render(
			await AgentPage({
				params: params({ id: owned?.id ?? "" }),
				searchParams: params({}),
			}),
		);
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
		expect(screen.getByText("Read status")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Create token" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Delete" }),
		).not.toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(
			1,
		);
		expect(screen.getByText("OAuth: Admin User")).toBeInTheDocument();
	});

	it("shows a migrated agent that has no activity yet", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		const secret = `icmd_${"b".repeat(32)}`;
		await app.store.insert("agent_tokens", {
			id: "agt_legacy",
			name: "Legacy",
			tokenHash: sha256(secret),
			tokenPrefix: secret.slice(0, 11),
			role: "editor",
			createdBy: { type: "member", id: actor.id, name: actor.name },
			createdAt: "2026-11-02T12:00:00.000Z",
		});
		await services.agents.migrate();
		render(
			await AgentPage({
				params: params({ id: "agt_legacy" }),
				searchParams: params({}),
			}),
		);
		expect(screen.getByText(/before permissions/)).toBeInTheDocument();
		expect(screen.getByText("No activity yet.")).toBeInTheDocument();
	});

	it("sends a member who cannot manage agents away from the new page", async () => {
		const { app } = await setupApp();
		await signIn(app, "editor");
		expectFlashRedirect(
			await redirectOf(NewAgentPage(flash())),
			"/manage",
			"error",
			"That page requires the admin role",
		);
		render(<AgentsLoading />);
	});

	it("uses the configured site url for the MCP endpoint", async () => {
		const { app } = await setupApp({ SITE_URL: "https://status.example.com" });
		await signIn(app, "admin");
		render(await AgentsPage(flash()));
		expect(
			screen.getAllByText(/https:\/\/status\.example\.com\/api\/mcp/).length,
		).toBeGreaterThan(0);
	});

	it("lists subscribers and warns about channels that cannot send", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		const empty = render(await SubscribersPage(flash()));
		expect(
			screen.getByText(/These channels cannot send now: Text messaging\./),
		).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /Text message/ })).toBeDisabled();
		expect(
			screen.getByRole("link", { name: "Settings → Notifications" }),
		).toHaveAttribute("href", "/manage/settings/notifications");
		expect(screen.getByText("No subscribers yet.")).toBeInTheDocument();
		empty.unmount();

		await services.notificationSettings.updateChannel(actor, "email", {
			enabled: false,
		});
		await services.subscribers.addWebhook(actor, {
			url: "https://hooks.example.com/a",
		});
		await services.subscribers.addSms(actor, { phone: "+15551234567" });
		const off = render(await SubscribersPage(flash()));
		expect(
			screen.getByText(
				/cannot send now: Email, Text messaging\. Their subscribers get no notifications, and the public subscribe page does not offer them\./,
			),
		).toBeInTheDocument();
		expect(screen.getByText("Subscribers (2)")).toBeInTheDocument();
		expect(screen.getByText(/Webhook · Confirmed/)).toBeInTheDocument();
		expect(screen.getByText(/Text message · Confirmed/)).toBeInTheDocument();
		off.unmount();

		await services.notificationSettings.updateChannel(actor, "email", {
			enabled: true,
		});
		await services.notificationSettings.updateChannel(actor, "sms", {
			from: "ACME",
		});
		await services.notificationSettings.addProvider(actor, "sms", {
			type: "sns",
			name: "SNS",
			values: { region: "us-east-1" },
		});
		await services.subscribers.subscribe({
			type: "email",
			target: "pending@example.com",
		});
		render(await SubscribersPage(flash()));
		expect(screen.queryByText(/cannot send now/)).not.toBeInTheDocument();
		expect(
			screen.getByText(/Email · Pending confirmation/),
		).toBeInTheDocument();
	});

	it("lets an admin set the services for a subscriber", async () => {
		const { app, services } = await setupApp();
		const { actor } = await signIn(app, "admin");
		const api = await services.catalog.create(actor, { name: "API" });
		await services.subscribers.addEmail(actor, {
			email: "api@acme.dev",
			serviceIds: [api.id],
		});
		render(await SubscribersPage(flash({ notice: "services_saved" })));
		expect(
			screen
				.getAllByRole("checkbox", { name: "API" })
				.map((box) => (box as HTMLInputElement).checked),
		).toEqual([false, true]);
		expect(
			screen.getByRole("button", { name: "Save services" }),
		).toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("Services saved");
	});

	it("renders the general settings section", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		await services.settings.update(SYSTEM_ACTOR, { uptimeDays: 30 });
		render(await SettingsPage(flash()));
		const tabs = screen.getByRole("navigation", { name: "Settings sections" });
		expect(within(tabs).getByRole("link", { name: "General" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(
			within(tabs).getByRole("link", { name: "Notifications" }),
		).toHaveAttribute("href", "/manage/settings/notifications");
		expect(screen.getByLabelText("Uptime window (days)")).toHaveValue(30);
		expect(
			screen.getByRole("checkbox", {
				name: "Require two-factor authentication",
			}),
		).toBeChecked();
		expect(screen.queryByLabelText("Custom CSS")).not.toBeInTheDocument();
	});

	it("renders branding with the current theme selected", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		await services.settings.update(SYSTEM_ACTOR, { theme: "sunset" });
		const first = render(await BrandingPage(flash()));
		expect(screen.getByRole("link", { name: "Branding" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByDisplayValue("sunset")).toBeChecked();
		expect(screen.getByLabelText("Logo")).toHaveAttribute("type", "file");
		expect(screen.getByLabelText("Favicon")).toHaveAttribute("type", "file");
		// The admin uploads each file. The form has no URL field.
		expect(screen.queryByLabelText(/URL/)).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText("Uptime window (days)"),
		).not.toBeInTheDocument();
		expect(screen.getByLabelText(/Powered by Incident Command/)).toBeChecked();
		first.unmount();

		// A stored id of a removed preset selects the preset that the site shows.
		// With no selection, the form sends no theme and the save fails.
		await services.settings.update(SYSTEM_ACTOR, {
			theme: "midnight",
			showPoweredBy: false,
		});
		render(await BrandingPage(flash()));
		expect(screen.getByDisplayValue("carbon")).toBeChecked();
		expect(
			screen.getByLabelText(/Powered by Incident Command/),
		).not.toBeChecked();
	});

	it("shows each uploaded file and a control to remove it", async () => {
		const { app, services } = await setupApp();
		await signIn(app, "admin");
		await services.settings.updateBranding(
			SYSTEM_ACTOR,
			{},
			{ logo: { bytes: PNG_LOGO } },
		);
		const first = render(await BrandingPage(flash()));
		expect(
			screen.getByRole("checkbox", { name: "Remove the uploaded logo" }),
		).not.toBeChecked();
		expect(
			screen.getByRole("img", { name: "The current logo" }),
		).toHaveAttribute("src", "/brand/logo?v=2026-11-02T12%3A00%3A00.000Z");
		// No favicon is stored, thus the form shows no favicon to remove.
		expect(
			screen.queryByRole("checkbox", { name: "Remove the uploaded favicon" }),
		).not.toBeInTheDocument();
		first.unmount();

		await services.settings.updateBranding(
			SYSTEM_ACTOR,
			{},
			{ favicon: { bytes: ICO_FAVICON } },
		);
		render(await BrandingPage(flash()));
		expect(
			screen.getByRole("checkbox", { name: "Remove the uploaded favicon" }),
		).not.toBeChecked();
		expect(
			screen.getByRole("img", { name: "The current favicon" }),
		).toHaveAttribute("src", "/brand/favicon?v=2026-11-02T12%3A00%3A00.000Z");
	});

	it("renders the notification channels without an encryption key", async () => {
		const { app } = await setupApp();
		await signIn(app, "admin");
		render(await NotificationsSettingsPage(flash()));
		expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("alert")).toHaveTextContent(
			"ENCRYPTION_KEY is not set",
		);
		const card = (name: string) =>
			screen.getByRole("heading", { name }).closest("section") as HTMLElement;
		const webhooks = within(card("Webhooks"));
		expect(webhooks.getByText("On")).toBeInTheDocument();
		// The server sends webhooks, so the card has only the on/off switch.
		expect(
			webhooks.getByRole("checkbox", { name: "Send webhook notifications" }),
		).toBeChecked();
		expect(webhooks.queryByRole("radio")).not.toBeInTheDocument();
		expect(webhooks.queryByRole("textbox")).not.toBeInTheDocument();
		expect(
			webhooks.queryByRole("heading", { name: "Providers" }),
		).not.toBeInTheDocument();
		expect(
			webhooks.queryByRole("button", { name: /Add provider/ }),
		).not.toBeInTheDocument();
		// Only the webhook channel has the private network switch, and it starts off.
		expect(
			webhooks.getByLabelText("Allow private network addresses"),
		).not.toBeChecked();
		expect(
			within(card("Email")).queryByLabelText("Allow private network addresses"),
		).not.toBeInTheDocument();
		expect(
			webhooks.getByRole("button", { name: "Save channel" }),
		).toBeInTheDocument();

		const email = within(card("Email"));
		expect(
			email.getByText(
				"No providers yet. Until you add one, this channel uses SendGrid (environment variables).",
			),
		).toBeInTheDocument();
		// The add form stays in a dialog until the admin opens it.
		expect(email.queryByRole("dialog")).not.toBeInTheDocument();
		expect(
			email.queryByRole("heading", { name: "Add a provider" }),
		).not.toBeInTheDocument();
		const addEmail = email.getByRole("button", {
			name: "Add provider for Email",
		});
		expect(
			addEmail.compareDocumentPosition(
				email.getByRole("heading", { name: "Providers" }),
			) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(email.getByRole("radio", { name: /Active\/passive/ })).toBeChecked();
		expect(email.getByLabelText("Default from address")).toHaveAttribute(
			"placeholder",
			"status@test.dev",
		);
		expect(
			email.getByText(/Leave empty to use status@test.dev \(EMAIL_FROM\)\./),
		).toBeInTheDocument();

		const user = userEvent.setup();
		await user.click(addEmail);
		const emailDialog = email.getByRole("dialog", { name: "Add a provider" });
		expect(
			within(emailDialog).getByRole("radio", { name: /SendGrid/ }),
		).toBeChecked();
		expect(within(emailDialog).getByLabelText("API key")).toBeDisabled();
		expect(
			within(emailDialog).getByText(
				"Set ENCRYPTION_KEY on the server to save credentials.",
			),
		).toBeInTheDocument();
		expect(
			within(emailDialog).queryByLabelText("Secret access key"),
		).not.toBeInTheDocument();
		// A click inside the dialog keeps it open. The choice changes the fields.
		await user.click(
			within(emailDialog).getByRole("radio", { name: /Amazon SES/ }),
		);
		expect(email.getByRole("dialog")).toBeInTheDocument();
		expect(within(emailDialog).getByLabelText("Region")).toBeRequired();
		expect(
			within(emailDialog).getByLabelText("Secret access key"),
		).toBeDisabled();
		expect(
			within(emailDialog).queryByLabelText("API key"),
		).not.toBeInTheDocument();
		expect(emailDialog.querySelector('input[name="type"]')).toHaveValue("ses");
		await user.click(
			within(emailDialog).getByRole("button", { name: "Cancel" }),
		);
		expect(email.queryByRole("dialog")).not.toBeInTheDocument();

		await user.click(addEmail);
		const reopened = email.getByRole("dialog", { name: "Add a provider" });
		expect(
			within(reopened).getByRole("radio", { name: /SendGrid/ }),
		).toBeChecked();
		const name = within(reopened).getByLabelText("Name");
		expect(name).toHaveValue("SendGrid");
		await user.clear(name);
		await user.type(name, "Primary");
		await user.click(within(reopened).getByRole("button", { name: "Cancel" }));
		expect(email.queryByRole("dialog")).not.toBeInTheDocument();
		await user.click(addEmail);
		expect(
			within(
				email.getByRole("dialog", { name: "Add a provider" }),
			).getByLabelText("Name"),
		).toHaveValue("SendGrid");
		await user.click(
			within(email.getByRole("dialog")).getByRole("button", { name: "Close" }),
		);
		expect(email.queryByRole("dialog")).not.toBeInTheDocument();

		const sms = within(card("Text messaging"));
		expect(sms.getByText("Not ready")).toBeInTheDocument();
		expect(
			sms.getByText("Add a provider so this channel can send."),
		).toBeInTheDocument();
		expect(sms.getByText("No providers yet.")).toBeInTheDocument();
		expect(
			sms.queryByRole("button", { name: "Add Twilio" }),
		).not.toBeInTheDocument();
		const addSms = sms.getByRole("button", {
			name: "Add provider for Text messaging",
		});
		expect(
			addSms.compareDocumentPosition(
				sms.getByRole("heading", { name: "Providers" }),
			) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		await user.click(addSms);
		const smsDialog = sms.getByRole("dialog", { name: "Add a provider" });
		expect(
			within(smsDialog).getByRole("button", { name: "Add Twilio" }),
		).toBeInTheDocument();
		expect(within(smsDialog).getByLabelText("Account SID")).toBeRequired();
		await user.click(
			within(smsDialog).getByRole("radio", { name: /Amazon SNS/ }),
		);
		expect(
			within(smsDialog).getByRole("button", { name: "Add Amazon SNS" }),
		).toBeInTheDocument();
		expect(
			within(smsDialog).queryByLabelText("Account SID"),
		).not.toBeInTheDocument();
		expect(smsDialog.querySelector('input[name="type"]')).toHaveValue("sns");
		await user.click(within(smsDialog).getByRole("button", { name: "Close" }));
		expect(sms.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("closes the add dialog after submit", async () => {
		const { app } = await setupApp();
		await signIn(app, "admin");
		render(await NotificationsSettingsPage(flash()));
		const user = userEvent.setup();
		const email = within(
			screen
				.getByRole("heading", { name: "Email" })
				.closest("section") as HTMLElement,
		);
		await user.click(
			email.getByRole("button", { name: "Add provider for Email" }),
		);
		const dialog = email.getByRole("dialog", { name: "Add a provider" });
		expect(dialog).toBeInTheDocument();
		const close = vi.spyOn(HTMLDialogElement.prototype, "close");
		// This server has no encryption key. The action returns an error.
		// The dialog must close. The error is on the page.
		await user.click(email.getByRole("button", { name: "Add SendGrid" }));
		await waitFor(() => {
			expect(close).toHaveBeenCalled();
		});
		expect(dialog).not.toHaveAttribute("open");
		close.mockRestore();
	});

	it("renders providers in order with their roles and saved credentials", async () => {
		const { app, services } = await setupApp({
			ENCRYPTION_KEY: "k".repeat(32),
			EMAIL_FROM: "",
		});
		const { actor } = await signIn(app, "admin");
		const settings = services.notificationSettings;
		await settings.addProvider(actor, "email", {
			type: "sendgrid",
			name: "SendGrid primary",
			values: { apiKey: "SG.key" },
		});
		await settings.addProvider(actor, "email", {
			type: "ses",
			name: "SES backup",
			from: "ses@acme.dev",
			values: {
				region: "us-east-1",
				accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				secretAccessKey: "secret",
			},
		});
		await settings.updateChannel(actor, "webhook", { enabled: false });
		// A provider whose credentials an unknown key encrypted.
		await app.store.insert("notification_channels", {
			id: "sms",
			enabled: true,
			strategy: "load_balanced",
			providers: [
				{
					id: "prv_lost",
					type: "twilio",
					name: "Lost key",
					options: { accountSid: `AC${"0".repeat(32)}` },
					secrets: { authToken: "v1.deadbeef.AAAA.AAAA" },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
			revision: 1,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		render(await NotificationsSettingsPage(flash()));
		expect(
			screen.queryByText(/ENCRYPTION_KEY is not set/),
		).not.toBeInTheDocument();
		const card = (name: string) =>
			within(
				screen.getByRole("heading", { name }).closest("section") as HTMLElement,
			);

		const email = card("Email");
		// Each save posts the revision that the page showed.
		const emailRevision = String((await settings.list(actor))[1]?.revision);
		const section = screen
			.getByRole("heading", { name: "Email" })
			.closest("section") as HTMLElement;
		const revisions = [
			...section.querySelectorAll<HTMLInputElement>('input[name="revision"]'),
		].map((input) => input.value);
		expect(revisions).toEqual([emailRevision, emailRevision, emailRevision]);
		const [first, second] = email.getAllByRole("listitem");
		expect(
			within(first as HTMLElement).getByText("SendGrid primary", {
				selector: "p",
			}),
		).toBeInTheDocument();
		expect(
			within(first as HTMLElement).getByText(
				"SendGrid · Active · API key saved",
			),
		).toBeInTheDocument();
		expect(
			within(second as HTMLElement).getByText(
				"Amazon SES · Passive 1 · From ses@acme.dev · Secret access key saved",
			),
		).toBeInTheDocument();
		expect(
			within(first as HTMLElement).queryByRole("button", { name: /Move up/ }),
		).not.toBeInTheDocument();
		expect(
			within(first as HTMLElement).getByRole("button", {
				name: "Move down SendGrid primary",
			}),
		).toBeInTheDocument();
		expect(
			within(second as HTMLElement).queryByRole("button", {
				name: /Move down/,
			}),
		).not.toBeInTheDocument();
		expect(
			within(first as HTMLElement).getByLabelText("API key"),
		).toHaveAttribute("placeholder", "Saved. Leave empty to keep it.");
		expect(
			within(first as HTMLElement).queryByText(/Remove the saved/),
		).not.toBeInTheDocument();
		expect(
			within(second as HTMLElement).getByLabelText(
				"Remove the saved secret access key",
			),
		).not.toBeChecked();
		expect(within(second as HTMLElement).getByLabelText("Region")).toHaveValue(
			"us-east-1",
		);
		expect(
			email.getByText(
				"This channel does not use SendGrid (environment variables) while it has providers.",
			),
		).toBeInTheDocument();
		// Without EMAIL_FROM, only the SES provider has a sender.
		expect(email.getByText("On")).toBeInTheDocument();
		expect(email.getByLabelText("Default from address")).toHaveAttribute(
			"placeholder",
			"Status <status@example.com>",
		);

		expect(card("Webhooks").getByText("Off")).toBeInTheDocument();

		const sms = card("Text messaging");
		expect(sms.getByText("Not ready")).toBeInTheDocument();
		expect(
			sms.getByText("Set a sender. The providers cannot send without one."),
		).toBeInTheDocument();
		expect(sms.getByRole("alert")).toHaveTextContent(
			"The saved credentials do not decrypt",
		);
		const [lost] = sms.getAllByRole("listitem");
		expect(
			within(lost as HTMLElement).getByText(
				"Twilio · Load balanced · Auth token saved",
			),
		).toBeInTheDocument();
		// A saved secret is not required again in the edit form.
		expect(
			within(lost as HTMLElement).getByLabelText("Auth token"),
		).not.toBeRequired();
	});

	it("renders the account page", async () => {
		const { app } = await setupApp();
		const { member } = await signIn(app, "viewer");
		render(await AccountPage(flash()));
		expect(
			screen.getByRole("heading", { name: "My Profile" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(member.email, { selector: "dd" }),
		).toBeInTheDocument();
		expect(screen.getByText("Viewer", { selector: "dd" })).toBeInTheDocument();
		expect(
			screen.getAllByRole("button", { name: "Sign out" }).length,
		).toBeGreaterThan(0);
	});
});
