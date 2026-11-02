import { createTestContext } from "../helpers";

describe("demo seed", () => {
	it("seeds an empty store once when enabled", async () => {
		const t = createTestContext({ env: { SEED_DEMO: "true" } });
		await t.services.bootstrap();
		await t.services.bootstrap();
		const summary = await t.services.status.summary();
		expect(summary.components).toHaveLength(5);
		expect(summary.upcomingMaintenance).toHaveLength(1);
		expect(summary.recentIncidents.map((i) => i.title)).toEqual([
			"Dashboard unavailable",
		]);
		expect(
			(await t.services.incidents.list({ kind: "incident" })).every(
				(i) => i.status === "resolved",
			),
		).toBe(true);
		expect(
			summary.components.find((c) => c.name === "Dashboard")?.uptime,
		).toBeLessThan(1);
		expect(t.notifier.incidents).toHaveLength(0);
	});

	it("is off by default", async () => {
		const t = createTestContext({ env: { SEED_DEMO: "false" } });
		await t.services.bootstrap();
		expect(await t.store.count("components")).toBe(0);
	});
});
