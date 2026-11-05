import type {
	Incident,
	Service,
	ServiceStatusChange,
} from "@/lib/domain/types";
import {
	computeUptime,
	DAY_MS,
	formatUptime,
	startOfUtcDay,
	toDateKey,
	uptimeWindow,
} from "@/lib/domain/uptime";

const NOW = new Date("2026-11-02T12:00:00.000Z");

function service(overrides: Partial<Service> = {}): Service {
	return {
		id: "c1",
		name: "API",
		status: "operational",
		order: 0,
		hidden: false,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function change(
	at: string,
	previousStatus: Service["status"],
	status: Service["status"],
	serviceId = "c1",
): ServiceStatusChange {
	return { id: `ch_${at}`, serviceId, status, previousStatus, createdAt: at };
}

function incident(overrides: Partial<Incident> = {}): Incident {
	return {
		id: "i1",
		kind: "incident",
		title: "Outage",
		status: "resolved",
		impact: "major",
		serviceIds: ["c1"],
		updates: [],
		startedAt: "2026-11-01T10:00:00.000Z",
		resolvedAt: "2026-11-01T11:00:00.000Z",
		createdBy: { type: "system", id: "system", name: "System" },
		createdAt: "2026-11-01T10:00:00.000Z",
		updatedAt: "2026-11-01T11:00:00.000Z",
		...overrides,
	};
}

describe("uptime helpers", () => {
	it("computes windows in whole UTC days", () => {
		const window = uptimeWindow(NOW, 3);
		expect(window.start.toISOString()).toBe("2026-10-31T00:00:00.000Z");
		expect(window.end).toBe(NOW);
		expect(startOfUtcDay(NOW).toISOString()).toBe("2026-11-02T00:00:00.000Z");
		expect(toDateKey(NOW)).toBe("2026-11-02");
	});

	it("formats uptime percentages", () => {
		expect(formatUptime(null)).toBe("No data");
		expect(formatUptime(1)).toBe("100%");
		expect(formatUptime(0.9999)).toBe("99.99%");
		expect(formatUptime(0.99995)).toBe("99.99%");
		expect(formatUptime(0.5)).toBe("50%");
		expect(formatUptime(0.995)).toBe("99.50%");
	});
});

describe("computeUptime", () => {
	const window = uptimeWindow(NOW, 3);

	it("reports full uptime with no changes", () => {
		const result = computeUptime(service(), [], [], window);
		expect(result.uptime).toBe(1);
		expect(result.days.map((day) => day.date)).toEqual([
			"2026-10-31",
			"2026-11-01",
			"2026-11-02",
		]);
		expect(
			result.days.every(
				(day) => day.status === "operational" && day.uptime === 1,
			),
		).toBe(true);
	});

	it("uses the current status when nothing changed", () => {
		const result = computeUptime(
			service({ status: "major_outage" }),
			[],
			[],
			window,
		);
		expect(result.uptime).toBe(0);
		expect(result.days[0]?.status).toBe("major_outage");
	});

	it("has no data before the service existed", () => {
		const result = computeUptime(
			service({ createdAt: "2026-11-01T12:00:00.000Z" }),
			[],
			[],
			window,
		);
		expect(result.days[0]).toEqual({
			date: "2026-10-31",
			status: null,
			uptime: null,
			incidents: [],
		});
		expect(result.days[1]?.status).toBe("operational");
		expect(result.uptime).toBe(1);
	});

	it("has no data at all for a service created in the future", () => {
		const result = computeUptime(
			service({ createdAt: "2026-12-01T00:00:00.000Z" }),
			[],
			[],
			window,
		);
		expect(result.uptime).toBeNull();
	});

	it("weights major and partial outages", () => {
		const changes = [
			change("2026-11-01T00:00:00.000Z", "operational", "major_outage"),
			change("2026-11-01T06:00:00.000Z", "major_outage", "partial_outage"),
			change(
				"2026-11-01T12:00:00.000Z",
				"partial_outage",
				"degraded_performance",
			),
			change("2026-11-01T18:00:00.000Z", "degraded_performance", "operational"),
			change(
				"2026-11-01T18:00:00.000Z",
				"degraded_performance",
				"operational",
				"other",
			),
		];
		const result = computeUptime(service(), changes, [], window);
		const day = result.days[1];
		expect(day?.status).toBe("major_outage");
		// 6h down + 6h * 0.3 = 7.8h of 24h
		expect(day?.uptime).toBeCloseTo(1 - 7.8 / 24, 10);
		expect(result.days[0]?.uptime).toBe(1);
		const tracked = 24 + 24 + 12;
		expect(result.uptime).toBeCloseTo(1 - 7.8 / tracked, 10);
	});

	it("starts from the first change's previous status", () => {
		const changes = [
			change("2026-11-02T06:00:00.000Z", "major_outage", "operational"),
		];
		const result = computeUptime(service(), changes, [], window);
		expect(result.days[0]?.status).toBe("major_outage");
		expect(result.days[2]?.status).toBe("major_outage");
		expect(result.days[2]?.uptime).toBeCloseTo(0.5, 10);
	});

	it("handles changes at the window start and at now", () => {
		const changes = [
			change("2026-10-31T00:00:00.000Z", "major_outage", "partial_outage"),
			change(NOW.toISOString(), "partial_outage", "operational"),
		];
		const result = computeUptime(service(), changes, [], window);
		expect(result.days.every((day) => day.status === "partial_outage")).toBe(
			true,
		);
		expect(result.uptime).toBeCloseTo(0.7, 10);
	});

	it("does not count maintenance as downtime", () => {
		const changes = [
			change("2026-11-02T00:00:00.000Z", "operational", "under_maintenance"),
		];
		const result = computeUptime(service(), changes, [], window);
		expect(result.days[2]?.status).toBe("under_maintenance");
		expect(result.days[2]?.uptime).toBe(1);
	});

	it("attaches incidents that overlap each day", () => {
		const incidents = [
			incident(),
			incident({
				id: "open",
				title: "Still open",
				startedAt: "2026-11-02T01:00:00.000Z",
				resolvedAt: undefined,
				status: "investigating",
			}),
			incident({ id: "maint", kind: "maintenance" }),
			incident({ id: "other", serviceIds: ["c2"] }),
			incident({
				id: "spanning",
				startedAt: "2026-10-31T23:00:00.000Z",
				resolvedAt: "2026-11-01T01:00:00.000Z",
			}),
		];
		const result = computeUptime(service(), [], incidents, window);
		expect(result.days[0]?.incidents.map((i) => i.id)).toEqual(["spanning"]);
		expect(result.days[1]?.incidents).toEqual([
			{ id: "i1", title: "Outage", impact: "major" },
			{ id: "spanning", title: "Outage", impact: "major" },
		]);
		expect(result.days[2]?.incidents.map((i) => i.id)).toEqual(["open"]);
	});

	it("exposes the day length constant", () => {
		expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
	});
});
