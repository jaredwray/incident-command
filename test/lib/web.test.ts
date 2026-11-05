import { POST as mcp } from "@/app/api/mcp/route";
import { GET as status } from "@/app/api/v1/status/route";
import { GET as feed } from "@/app/feed.xml/route";
import { GET as health } from "@/app/healthz/route";
import { createApp, setApp } from "@/lib/app";
import { loadConfig } from "@/lib/config";
import { buildRssFeed, escapeXml } from "@/lib/feed";
import {
	formatDateTime,
	formatDay,
	formatDuration,
	formatMonth,
	formatMonthRange,
	fromDateTimeInput,
	toDateTimeInput,
} from "@/lib/format";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import { fallbackSettings, loadSiteSettings } from "@/lib/site";
import {
	brandStyle,
	readableForeground,
	resolveTheme,
	sanitizeCss,
	THEMES,
} from "@/lib/theme";
import { Clock, FakeNotifier } from "../helpers";

async function setup(env: Record<string, string> = {}) {
	const clock = new Clock();
	const app = await createApp({
		config: loadConfig(env),
		notifier: new FakeNotifier(),
		now: clock.now,
	});
	setApp(app);
	return { app, clock, services: app.services };
}

afterEach(() => setApp(undefined));

describe("API routes", () => {
	it("reports health", async () => {
		const { app } = await setup();
		const ok = await health();
		expect(ok.status).toBe(200);
		expect(await ok.json()).toMatchObject({
			status: "ok",
			store: { online: true, kind: "memory" },
		});

		vi.spyOn(app.store.inner, "ping").mockRejectedValueOnce(new Error("down"));
		const degraded = await health();
		expect(degraded.status).toBe(200);
		expect(await degraded.json()).toMatchObject({
			status: "degraded",
			store: { online: false, lastError: "down" },
		});

		setApp(Promise.reject(new Error("cannot connect")));
		const unavailable = await health();
		expect(unavailable.status).toBe(503);
		expect(await unavailable.json()).toEqual({
			status: "unavailable",
			error: "cannot connect",
		});

		setApp(Promise.reject("weird"));
		expect(await (await health()).json()).toEqual({
			status: "unavailable",
			error: "weird",
		});
	});

	it("serves the public status json", async () => {
		const { services } = await setup();
		const api = await services.components.create(SYSTEM_ACTOR, {
			name: "API",
			description: "Public",
			group: "Core",
		});
		const hidden = await services.components.create(SYSTEM_ACTOR, {
			name: "Secret",
			hidden: true,
		});
		const web = await services.components.create(SYSTEM_ACTOR, { name: "Web" });
		const incident = await services.incidents.create(SYSTEM_ACTOR, {
			title: "Down",
			message: "Looking",
			impact: "critical",
			componentIds: [api.id, hidden.id],
		});
		await services.incidents.postUpdate(SYSTEM_ACTOR, incident.id, {
			message: "Still looking",
		});
		await services.incidents.create(SYSTEM_ACTOR, {
			kind: "maintenance",
			title: "Upgrade",
			message: "Soon",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		const response = await status();
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		const body = await response.json();
		expect(body.status).toEqual({
			indicator: "major_outage",
			description: "We're experiencing a major outage",
		});
		expect(body.components).toEqual([
			{
				id: api.id,
				name: "API",
				description: "Public",
				group: "Core",
				status: "major_outage",
				uptime: null,
			},
			{
				id: web.id,
				name: "Web",
				description: null,
				group: null,
				status: "operational",
				uptime: null,
			},
		]);
		expect(body.incidents[0]).toMatchObject({
			title: "Down",
			components: [api.id],
			resolvedAt: null,
			scheduledStart: null,
		});
		expect(
			body.incidents[0].updates.map((u: { message: string }) => u.message),
		).toEqual(["Still looking", "Looking"]);
		expect(body.maintenance.upcoming[0]).toMatchObject({
			title: "Upgrade",
			scheduledStart: "2026-11-05T00:00:00.000Z",
		});
		expect(body.page).toEqual({ name: "Status", url: null });
	});

	it("serves an rss feed", async () => {
		const { services } = await setup();
		await services.incidents.create(SYSTEM_ACTOR, {
			title: "Down & out",
			message: "<b>Looking</b>",
		});
		const response = await feed(
			new Request("https://status.acme.dev/feed.xml"),
		);
		expect(response.headers.get("content-type")).toContain(
			"application/rss+xml",
		);
		const xml = await response.text();
		expect(xml).toContain("<title>Down &amp; out</title>");
		expect(xml).toContain("https://status.acme.dev/incidents/inc_");
		expect(xml).toContain("Investigating: &lt;b&gt;Looking&lt;/b&gt;");

		await services.settings.update(SYSTEM_ACTOR, {
			siteUrl: "https://configured.example.com",
		});
		expect(
			await (await feed(new Request("http://internal/feed.xml"))).text(),
		).toContain("https://configured.example.com/incidents/");
	});

	it("routes MCP requests through the app", async () => {
		await setup();
		const response = await mcp(
			new Request("http://localhost/api/mcp", { method: "POST", body: "{}" }),
		);
		expect(response.status).toBe(401);
	});
});

describe("feed helpers", () => {
	it("escapes xml and handles empty feeds and incidents without updates", () => {
		expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
			"&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;",
		);
		const xml = buildRssFeed(fallbackSettings(), [], "");
		expect(xml).toContain("<link>/</link>");
		const bare = buildRssFeed(
			fallbackSettings(),
			[
				{
					id: "i",
					kind: "incident",
					title: "T",
					status: "investigating",
					impact: "minor",
					componentIds: [],
					updates: [],
					startedAt: "2026-11-02T00:00:00.000Z",
					createdBy: { type: "system", id: "s", name: "S" },
					createdAt: "2026-11-02T00:00:00.000Z",
					updatedAt: "2026-11-02T00:00:00.000Z",
				},
			],
			"https://x.co/",
		);
		expect(bare).toContain("<description></description>");
		expect(bare).toContain("<link>https://x.co/incidents/i</link>");
	});
});

describe("site settings", () => {
	it("loads settings and falls back when the app fails", async () => {
		await setup({ SITE_NAME: "Acme" });
		expect((await loadSiteSettings()).siteName).toBe("Acme");
		setApp(Promise.reject(new Error("db down")));
		expect((await loadSiteSettings()).allowSubscriptions).toBe(false);
	});
});

describe("format helpers", () => {
	it("formats dates in UTC", () => {
		expect(formatDateTime("2026-11-02T14:05:00.000Z")).toBe(
			"Nov 2, 2026, 14:05 UTC",
		);
		expect(formatDay("2026-11-02")).toBe("Nov 2, 2026");
		expect(formatDay("2026-11-02T23:59:00.000Z")).toBe("Nov 2, 2026");
		expect(formatMonth("2026-11")).toBe("November 2026");
		expect(
			formatMonthRange(
				new Date("2026-08-05T00:00:00Z"),
				new Date("2026-11-02T00:00:00Z"),
			),
		).toBe("Aug 2026 – Nov 2026");
		expect(
			formatMonthRange(
				new Date("2026-11-01T00:00:00Z"),
				new Date("2026-11-02T00:00:00Z"),
			),
		).toBe("Nov 2026");
	});

	it("formats durations", () => {
		expect(formatDuration(30_000)).toBe("< 1m");
		expect(formatDuration(45 * 60_000)).toBe("45m");
		expect(formatDuration(2 * 3_600_000)).toBe("2h");
		expect(formatDuration(26 * 3_600_000 + 5 * 60_000)).toBe("1d 2h 5m");
	});

	it("converts datetime-local values", () => {
		expect(toDateTimeInput("2026-11-02T14:05:00.000Z")).toBe(
			"2026-11-02T14:05",
		);
		expect(toDateTimeInput(undefined)).toBe("");
		expect(fromDateTimeInput("2026-11-02T14:05")).toBe(
			"2026-11-02T14:05:00.000Z",
		);
		expect(fromDateTimeInput("2026-11-02T14:05:30")).toBe(
			"2026-11-02T14:05:30.000Z",
		);
		expect(fromDateTimeInput("")).toBeUndefined();
		expect(fromDateTimeInput("garbage")).toBe("garbage");
	});
});

describe("theme helpers", () => {
	it("resolves themes and brand colors", () => {
		expect(THEMES.map((theme) => theme.id)).toEqual([
			"default",
			"midnight",
			"ocean",
			"sunset",
			"mono",
		]);
		expect(resolveTheme("ocean")).toBe("ocean");
		expect(resolveTheme("nope")).toBe("default");
		expect(resolveTheme(undefined)).toBe("default");
		expect(readableForeground("#ffffff")).toBe("#0b0b0f");
		expect(readableForeground("#000000")).toBe("#ffffff");
		expect(readableForeground("#020202")).toBe("#ffffff");
		expect(brandStyle({})).toEqual({});
		expect(brandStyle({ brandColor: "#4f46e5" })).toEqual({
			"--ic-brand": "#4f46e5",
			"--ic-brand-fg": "#ffffff",
		});
		expect(sanitizeCss(undefined)).toBe("");
		expect(sanitizeCss("a</style>")).toBe("a\\3c /style>");
	});
});
