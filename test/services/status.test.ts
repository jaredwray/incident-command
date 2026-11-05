import { ADMIN, createTestContext, EDITOR, type TestContext } from "../helpers";

describe("StatusService", () => {
	let t: TestContext;
	beforeEach(() => {
		t = createTestContext();
	});

	it("summarizes an empty page as operational", async () => {
		const summary = await t.services.status.summary();
		expect(summary.overall).toBe("operational");
		expect(summary.groups).toEqual([]);
		expect(summary.window.days).toBe(90);
		expect(summary.window.start.toISOString()).toBe("2026-08-05T00:00:00.000Z");
		expect(summary.generatedAt).toBe("2026-11-02T12:00:00.000Z");
	});

	it("groups services, computes uptime and the overall status", async () => {
		t.clock.set("2026-10-01T00:00:00.000Z");
		const api = await t.services.catalog.create(EDITOR, {
			name: "API",
			group: "Core",
		});
		await t.services.catalog.create(EDITOR, { name: "Web" });
		await t.services.catalog.create(EDITOR, {
			name: "Workers",
			group: "Core",
		});
		await t.services.catalog.create(EDITOR, {
			name: "Secret",
			hidden: true,
			status: "major_outage",
		});
		t.clock.set("2026-11-01T10:00:00.000Z");
		const incident = await t.services.incidents.create(EDITOR, {
			title: "API down",
			message: "Down",
			impact: "critical",
			serviceIds: [api.id],
		});
		t.clock.set("2026-11-01T11:00:00.000Z");
		await t.services.incidents.resolve(EDITOR, incident.id);
		t.clock.set("2026-11-02T12:00:00.000Z");

		const summary = await t.services.status.summary();
		expect(
			summary.groups.map((g) => [g.name, g.services.map((c) => c.name)]),
		).toEqual([
			["Core", ["API", "Workers"]],
			[null, ["Web"]],
		]);
		expect(summary.overall).toBe("operational");
		const apiView = summary.services.find((c) => c.id === api.id);
		const day = apiView?.days.find((d) => d.date === "2026-11-01");
		expect(day?.status).toBe("major_outage");
		expect(day?.incidents.map((i) => i.id)).toEqual([incident.id]);
		expect(apiView?.uptime).toBeLessThan(1);
		expect(apiView?.days[0]?.status).toBeNull();
		expect(summary.recentIncidents.map((i) => i.id)).toEqual([incident.id]);
		expect(summary.activeIncidents).toEqual([]);
	});

	it("reflects active incidents and maintenance", async () => {
		const api = await t.services.catalog.create(EDITOR, { name: "API" });
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Elevated errors",
			message: "Hmm",
			impact: "major",
		});
		const soon = await t.services.incidents.create(EDITOR, {
			kind: "maintenance",
			title: "Later",
			message: "Later",
			scheduledStart: "2026-11-10T00:00:00.000Z",
			scheduledEnd: "2026-11-10T01:00:00.000Z",
		});
		const sooner = await t.services.incidents.create(EDITOR, {
			kind: "maintenance",
			title: "Sooner",
			message: "Sooner",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		const running = await t.services.incidents.create(EDITOR, {
			kind: "maintenance",
			title: "Now",
			message: "Now",
			status: "in_progress",
			serviceIds: [api.id],
			scheduledStart: "2026-11-02T11:00:00.000Z",
			scheduledEnd: "2026-11-02T13:00:00.000Z",
		});
		const summary = await t.services.status.summary();
		expect(summary.activeIncidents.map((i) => i.id)).toEqual([incident.id]);
		expect(summary.activeMaintenance.map((i) => i.id)).toEqual([running.id]);
		expect(summary.upcomingMaintenance.map((i) => i.id)).toEqual([
			sooner.id,
			soon.id,
		]);
		expect(summary.recentIncidents.map((i) => i.id)).not.toContain(soon.id);
		expect(summary.overall).toBe("partial_outage");
		expect(summary.services[0]?.status).toBe("under_maintenance");

		await t.services.incidents.resolve(EDITOR, incident.id);
		expect((await t.services.status.summary()).overall).toBe(
			"under_maintenance",
		);
	});

	it("honors the configured uptime window", async () => {
		await t.services.settings.update(ADMIN, { uptimeDays: 7 });
		const summary = await t.services.status.summary();
		expect(summary.window.days).toBe(7);
	});

	it("paginates history by month", async () => {
		t.clock.set("2026-08-15T00:00:00.000Z");
		const august = await t.services.incidents.create(EDITOR, {
			title: "Aug",
			message: "a",
			status: "resolved",
		});
		t.clock.set("2026-10-20T00:00:00.000Z");
		const october = await t.services.incidents.create(EDITOR, {
			title: "Oct",
			message: "o",
			status: "resolved",
		});
		await t.services.incidents.create(EDITOR, {
			kind: "maintenance",
			title: "Future",
			message: "f",
			scheduledStart: "2026-12-01T00:00:00.000Z",
			scheduledEnd: "2026-12-01T01:00:00.000Z",
		});
		t.clock.set("2026-11-02T12:00:00.000Z");

		const latest = await t.services.status.history();
		expect(latest.months.map((m) => m.key)).toEqual([
			"2026-11",
			"2026-10",
			"2026-09",
		]);
		expect(latest.months[1]?.incidents.map((i) => i.id)).toEqual([october.id]);
		expect(latest.older).toBe("2026-08");
		expect(latest.newer).toBeNull();

		const older = await t.services.status.history("2026-08");
		expect(older.months.map((m) => m.key)).toEqual([
			"2026-08",
			"2026-07",
			"2026-06",
		]);
		expect(older.months[0]?.incidents.map((i) => i.id)).toEqual([august.id]);
		expect(older.newer).toBe("2026-11");

		const middle = await t.services.status.history("2026-06", 2);
		expect(middle.newer).toBe("2026-08");
		const recent = await t.services.status.history("2026-10");
		expect(recent.newer).toBe("2026-11");

		expect((await t.services.status.history("2027-01")).newer).toBeNull();
		expect((await t.services.status.history("garbage")).months[0]?.key).toBe(
			"2026-11",
		);
	});
});
