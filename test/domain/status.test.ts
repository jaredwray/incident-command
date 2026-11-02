import {
	COMPONENT_STATUS_LABELS,
	closedStatus,
	EVENT_STATUS_LABELS,
	hasRole,
	impactToStatus,
	initialStatus,
	isClosedStatus,
	isOpen,
	OVERALL_STATUS_COPY,
	statusSeverity,
	worstStatus,
} from "@/lib/domain/status";
import { COMPONENT_STATUSES } from "@/lib/domain/types";

describe("status helpers", () => {
	it("ranks statuses by severity", () => {
		expect(statusSeverity("operational")).toBe(0);
		expect(statusSeverity("major_outage")).toBeGreaterThan(
			statusSeverity("partial_outage"),
		);
		expect(worstStatus([])).toBe("operational");
		expect(
			worstStatus(["degraded_performance", "major_outage", "operational"]),
		).toBe("major_outage");
		expect(worstStatus(["under_maintenance", "operational"])).toBe(
			"under_maintenance",
		);
	});

	it("maps impact to component status", () => {
		expect(impactToStatus("none")).toBe("operational");
		expect(impactToStatus("minor")).toBe("degraded_performance");
		expect(impactToStatus("major")).toBe("partial_outage");
		expect(impactToStatus("critical")).toBe("major_outage");
	});

	it("knows open and closed statuses per kind", () => {
		expect(isClosedStatus("resolved")).toBe(true);
		expect(isClosedStatus("completed")).toBe(true);
		expect(isClosedStatus("monitoring")).toBe(false);
		expect(isOpen({ status: "investigating" })).toBe(true);
		expect(initialStatus("incident")).toBe("investigating");
		expect(initialStatus("maintenance")).toBe("scheduled");
		expect(closedStatus("incident")).toBe("resolved");
		expect(closedStatus("maintenance")).toBe("completed");
	});

	it("compares roles hierarchically", () => {
		expect(hasRole("admin", "editor")).toBe(true);
		expect(hasRole("editor", "editor")).toBe(true);
		expect(hasRole("viewer", "editor")).toBe(false);
	});

	it("has copy for every status", () => {
		for (const status of COMPONENT_STATUSES) {
			expect(COMPONENT_STATUS_LABELS[status]).toBeTruthy();
			expect(OVERALL_STATUS_COPY[status].title).toBeTruthy();
		}
		expect(EVENT_STATUS_LABELS.in_progress).toBe("In progress");
	});
});
