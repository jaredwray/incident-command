import { render, screen, within } from "@testing-library/react";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorPage from "@/app/error";
import HistoryPage from "@/app/history/page";
import IncidentPage, {
	generateMetadata as incidentMetadata,
} from "@/app/incidents/[id]/page";
import RootLayout, {
	generateMetadata as layoutMetadata,
	viewport,
} from "@/app/layout";
import NotFound from "@/app/not-found";
import StatusPage from "@/app/page";
import ConfirmPage from "@/app/subscribe/confirm/page";
import SubscribePage from "@/app/subscribe/page";
import UnsubscribePage from "@/app/subscribe/unsubscribe/page";
import { setApp } from "@/lib/app";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import { expectNotFound, params, sealedFlashParams, setupApp } from "./app";

describe("root layout", () => {
	it("applies the theme, brand color and escaped custom css", async () => {
		const { services } = await setupApp({ SITE_NAME: "Acme" });
		await services.settings.update(SYSTEM_ACTOR, {
			theme: "ocean",
			brandColor: "#ffcc00",
			customCss: "body{color:red}</style><script>alert(1)</script>",
			faviconUrl: "https://acme.dev/favicon.ico",
			description: "Acme services",
		});
		const html = renderToStaticMarkup(
			await RootLayout({ children: <p>child</p> }),
		);
		expect(html).toContain('data-theme="ocean"');
		expect(html).toContain("--ic-brand:#ffcc00");
		expect(html).toContain("--ic-brand-fg:#0b0b0f");
		expect(html).toContain("body{color:red}\\3c /style>\\3c script>");
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("<p>child</p>");
		const metadata = await layoutMetadata();
		expect(metadata.title).toEqual({ default: "Acme", template: "%s · Acme" });
		expect(metadata.description).toBe("Acme services");
		expect(metadata.icons).toEqual({ icon: "https://acme.dev/favicon.ico" });
		expect(viewport.width).toBe("device-width");
	});

	it("falls back to defaults without custom settings or a working app", async () => {
		await setupApp();
		const html = renderToStaticMarkup(await RootLayout({ children: null }));
		expect(html).toContain('data-theme="default"');
		expect(html).not.toContain("custom-css");
		const metadata = await layoutMetadata();
		expect(metadata.description).toBe(
			"Current status and incident history for Status.",
		);
		expect(metadata.icons).toBeUndefined();

		setApp(Promise.reject(new Error("db down")));
		vi.stubEnv("SITE_NAME", "Fallback");
		expect((await layoutMetadata()).title).toEqual({
			default: "Fallback",
			template: "%s · Fallback",
		});
		vi.stubEnv("SITE_NAME", "");
		expect((await layoutMetadata()).title).toEqual({
			default: "Status",
			template: "%s · Status",
		});
		vi.unstubAllEnvs();
	});
});

describe("status page", () => {
	it("renders an empty, operational page", async () => {
		const { notifier } = await setupApp();
		notifier.emailEnabled = false;
		render(await StatusPage());
		expect(
			screen.getByRole("heading", { name: "We're fully operational" }),
		).toBeInTheDocument();
		expect(
			screen.getByText("No services have been added yet."),
		).toBeInTheDocument();
		expect(
			screen.getByText("No incidents reported in the last 14 days."),
		).toBeInTheDocument();
		expect(screen.queryByText("Subscribe to updates")).not.toBeInTheDocument();
	});

	it("renders services, incidents and maintenance", async () => {
		const { services, clock } = await setupApp();
		await services.settings.update(SYSTEM_ACTOR, {
			siteName: "Acme",
			description: "Live status for Acme",
			logoUrl: "https://acme.dev/logo.svg",
			supportUrl: "https://acme.dev/help",
		});
		clock.set("2026-10-01T00:00:00.000Z");
		const api = await services.catalog.create(SYSTEM_ACTOR, {
			name: "API",
			group: "Core",
			description: "Public API",
		});
		await services.catalog.create(SYSTEM_ACTOR, { name: "Website" });
		clock.set("2026-11-02T12:00:00.000Z");
		await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "Looking into it",
			impact: "major",
			serviceIds: [api.id],
		});
		await services.incidents.create(SYSTEM_ACTOR, {
			kind: "maintenance",
			title: "DB upgrade",
			message: "Upgrading",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T02:00:00.000Z",
		});
		await services.incidents.create(SYSTEM_ACTOR, {
			kind: "maintenance",
			title: "Edge migration",
			message: "Migrating",
			status: "in_progress",
			scheduledStart: "2026-11-02T11:00:00.000Z",
			scheduledEnd: "2026-11-02T13:00:00.000Z",
		});
		render(await StatusPage());
		expect(
			screen.getByRole("heading", {
				name: "We're experiencing a partial outage",
			}),
		).toBeInTheDocument();
		expect(screen.getByText("Live status for Acme")).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "Acme" })).toHaveAttribute(
			"src",
			"https://acme.dev/logo.svg",
		);
		expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
			"href",
			"https://acme.dev/help",
		);
		expect(
			screen.getByRole("link", { name: "Subscribe to updates" }),
		).toHaveAttribute("href", "/subscribe");

		const active = screen.getByRole("region", { name: "Active incidents" });
		expect(
			within(active).getByRole("link", { name: "API errors" }),
		).toBeInTheDocument();
		expect(within(active).getByText("Affects API")).toBeInTheDocument();
		expect(within(active).getByText("Edge migration")).toBeInTheDocument();
		expect(screen.getByText("Upcoming maintenance")).toBeInTheDocument();
		expect(screen.getByText("DB upgrade")).toBeInTheDocument();

		expect(screen.getByText("Core")).toBeInTheDocument();
		expect(screen.getByText("Partial outage")).toBeInTheDocument();
		expect(screen.getByText("100% uptime")).toBeInTheDocument();
		expect(
			screen.getAllByRole("listitem", { name: /Nov 2, 2026/ }).length,
		).toBeGreaterThan(0);
		expect(screen.getByText("Aug 2026 – Nov 2026")).toBeInTheDocument();
		expect(screen.getAllByText("API errors").length).toBeGreaterThan(1);
	});
});

describe("incident page", () => {
	it("renders an incident with its timeline", async () => {
		const { services, clock } = await setupApp();
		const api = await services.catalog.create(SYSTEM_ACTOR, { name: "API" });
		const hidden = await services.catalog.create(SYSTEM_ACTOR, {
			name: "Secret",
			hidden: true,
		});
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "API errors",
			message: "Investigating",
			impact: "critical",
			serviceIds: [api.id, hidden.id],
		});
		clock.advance(95 * 60_000);
		await services.incidents.resolve(SYSTEM_ACTOR, incident.id, "All good");
		render(await IncidentPage({ params: params({ id: incident.id }) }));
		expect(
			screen.getByRole("heading", { level: 1, name: "API errors" }),
		).toBeInTheDocument();
		expect(screen.getByText("Critical impact")).toBeInTheDocument();
		expect(
			screen.getByText("Resolved", { selector: "dt" }),
		).toBeInTheDocument();
		expect(screen.getByText(/1h 35m/)).toBeInTheDocument();
		expect(screen.getByText("API", { selector: "dd" })).toBeInTheDocument();
		expect(screen.queryByText(/Secret/)).not.toBeInTheDocument();
		expect(screen.getByText("All good")).toBeInTheDocument();
		expect(screen.queryByText(/System \(system\)/)).not.toBeInTheDocument();
		expect(
			await incidentMetadata({ params: params({ id: incident.id }) }),
		).toEqual({ title: "API errors" });
	});

	it("renders maintenance windows", async () => {
		const { services } = await setupApp();
		const maintenance = await services.incidents.create(SYSTEM_ACTOR, {
			kind: "maintenance",
			title: "DB upgrade",
			message: "Upgrading",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T02:00:00.000Z",
		});
		await services.incidents.resolve(SYSTEM_ACTOR, maintenance.id);
		render(await IncidentPage({ params: params({ id: maintenance.id }) }));
		expect(screen.getByText("Scheduled maintenance")).toBeInTheDocument();
		expect(screen.getByText("Window")).toBeInTheDocument();
		expect(
			screen.getByText("Completed", { selector: "dt" }),
		).toBeInTheDocument();
		expect(screen.queryByText(/impact$/)).not.toBeInTheDocument();
	});

	it("404s for unknown incidents", async () => {
		await setupApp();
		await expectNotFound(IncidentPage({ params: params({ id: "nope" }) }));
		expect(await incidentMetadata({ params: params({ id: "nope" }) })).toEqual({
			title: "Incident not found",
		});
	});
});

describe("history page", () => {
	it("lists months with pagination", async () => {
		const { services, clock } = await setupApp();
		clock.set("2026-10-10T00:00:00.000Z");
		await services.incidents.create(SYSTEM_ACTOR, {
			title: "October blip",
			message: "x",
			status: "resolved",
		});
		clock.set("2026-11-02T12:00:00.000Z");
		render(await HistoryPage({ searchParams: params({}) }));
		expect(
			screen.getByRole("heading", { name: "November 2026" }),
		).toBeInTheDocument();
		expect(screen.getByText("October blip")).toBeInTheDocument();
		expect(screen.getAllByText("No incidents reported.")).toHaveLength(2);
		expect(screen.getByRole("link", { name: "← Older" })).toHaveAttribute(
			"href",
			"/history?month=2026-08",
		);
		expect(
			screen.queryByRole("link", { name: "Newer →" }),
		).not.toBeInTheDocument();
	});

	it("links to newer pages", async () => {
		await setupApp();
		render(await HistoryPage({ searchParams: params({ month: "2026-05" }) }));
		expect(screen.getByRole("link", { name: "Newer →" })).toHaveAttribute(
			"href",
			"/history?month=2026-08",
		);
	});
});

describe("subscription pages", () => {
	it("shows the form, outcomes and errors", async () => {
		await setupApp({ SITE_NAME: "Acme" });
		const { unmount } = render(
			await SubscribePage({ searchParams: params({}) }),
		);
		expect(
			screen.getByRole("heading", { name: "Get Acme updates" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Email address")).toBeInTheDocument();
		unmount();

		const errored = render(
			await SubscribePage({
				searchParams: params(
					sealedFlashParams({ error: "email: Invalid email address" }),
				),
			}),
		);
		expect(screen.getByRole("alert")).toHaveTextContent(
			"email: Invalid email address",
		);
		errored.unmount();

		const forged = render(
			await SubscribePage({
				searchParams: params({ error: "email: Invalid email address" }),
			}),
		);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		forged.unmount();

		const sent = render(
			await SubscribePage({
				searchParams: params({ status: "confirmation_sent" }),
			}),
		);
		expect(screen.getByText("Check your inbox")).toBeInTheDocument();
		sent.unmount();

		render(
			await SubscribePage({
				searchParams: params({ status: "already_subscribed" }),
			}),
		);
		expect(screen.getByText("You're already subscribed")).toBeInTheDocument();
	});

	it("explains when subscriptions are unavailable", async () => {
		const { notifier } = await setupApp();
		notifier.emailEnabled = false;
		render(
			await SubscribePage({
				searchParams: params({ status: "confirmation_sent" }),
			}),
		);
		expect(
			screen.getByText("Subscriptions are not available"),
		).toBeInTheDocument();
	});

	it("confirms subscriptions", async () => {
		const { services, notifier } = await setupApp();
		await services.subscribers.subscribe({ email: "jane@example.com" });
		const token = notifier.confirmations[0]?.token;
		const ok = render(await ConfirmPage({ searchParams: params({ token }) }));
		expect(screen.getByText("You're subscribed")).toBeInTheDocument();
		expect(
			screen.getByText(/jane@example.com will now receive/),
		).toBeInTheDocument();
		ok.unmount();
		render(await ConfirmPage({ searchParams: params({}) }));
		expect(screen.getByText("This link is invalid")).toBeInTheDocument();
	});

	it("renders the unsubscribe confirmation and result", async () => {
		await setupApp();
		const page = render(
			await UnsubscribePage({ searchParams: params({ token: "abc" }) }),
		);
		expect(
			screen.getByRole("button", { name: "Unsubscribe" }),
		).toBeInTheDocument();
		expect(document.querySelector('input[name="token"]')).toHaveValue("abc");
		page.unmount();
		const empty = render(await UnsubscribePage({ searchParams: params({}) }));
		expect(document.querySelector('input[name="token"]')).toHaveValue("");
		empty.unmount();
		render(await UnsubscribePage({ searchParams: params({ done: "1" }) }));
		expect(screen.getByText("You've been unsubscribed")).toBeInTheDocument();
	});
});

describe("error pages", () => {
	it("renders not found and error boundaries", async () => {
		const { unmount } = render(<NotFound />);
		expect(screen.getByText("Page not found")).toBeInTheDocument();
		unmount();
		const reset = vi.fn();
		render(<ErrorPage error={new Error("x")} reset={reset} />);
		expect(screen.getByText("Something went wrong")).toBeInTheDocument();
		screen.getByRole("button", { name: "Try again" }).click();
		expect(reset).toHaveBeenCalled();
	});

	it("asks for a reload when the server does not know the action", () => {
		// A deploy changed the server action ids after the page loaded. `reset`
		// keeps the stale ids, so the page must reload instead.
		const location = window.location;
		const reload = vi.fn();
		Object.defineProperty(window, "location", {
			configurable: true,
			value: { ...location, reload },
		});
		try {
			const reset = vi.fn();
			render(
				<ErrorPage error={new UnrecognizedActionError("gone")} reset={reset} />,
			);
			expect(screen.getByText("This page is out of date")).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: "Try again" }),
			).not.toBeInTheDocument();
			screen.getByRole("button", { name: "Reload" }).click();
			expect(reload).toHaveBeenCalledOnce();
			expect(reset).not.toHaveBeenCalled();
		} finally {
			Object.defineProperty(window, "location", {
				configurable: true,
				value: location,
			});
		}
	});
});
