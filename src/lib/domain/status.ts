import type {
	EventStatus,
	Incident,
	IncidentImpact,
	IncidentKind,
	Role,
	ServiceStatus,
} from "./types";
import { ROLES, SERVICE_STATUSES } from "./types";

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
	operational: "Operational",
	under_maintenance: "Under maintenance",
	degraded_performance: "Degraded performance",
	partial_outage: "Partial outage",
	major_outage: "Major outage",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
	investigating: "Investigating",
	identified: "Identified",
	monitoring: "Monitoring",
	resolved: "Resolved",
	scheduled: "Scheduled",
	in_progress: "In progress",
	verifying: "Verifying",
	completed: "Completed",
};

export const IMPACT_LABELS: Record<IncidentImpact, string> = {
	none: "None",
	minor: "Minor",
	major: "Major",
	critical: "Critical",
};

export const ROLE_LABELS: Record<Role, string> = {
	viewer: "Viewer",
	editor: "Editor",
	admin: "Admin",
};

export interface OverallStatusCopy {
	title: string;
	description: string;
}

export const OVERALL_STATUS_COPY: Record<ServiceStatus, OverallStatusCopy> = {
	operational: {
		title: "We're fully operational",
		description: "We're not aware of any issues affecting our systems.",
	},
	under_maintenance: {
		title: "Maintenance in progress",
		description: "Some systems are undergoing scheduled maintenance.",
	},
	degraded_performance: {
		title: "We're experiencing degraded performance",
		description: "Some systems are running slower than usual.",
	},
	partial_outage: {
		title: "We're experiencing a partial outage",
		description: "Some systems are not working as expected.",
	},
	major_outage: {
		title: "We're experiencing a major outage",
		description: "We're working to restore service as quickly as possible.",
	},
};

/** Higher numbers are worse. */
export function statusSeverity(status: ServiceStatus): number {
	return SERVICE_STATUSES.indexOf(status);
}

export function worstStatus(statuses: Iterable<ServiceStatus>): ServiceStatus {
	let worst: ServiceStatus = "operational";
	for (const status of statuses) {
		if (statusSeverity(status) > statusSeverity(worst)) {
			worst = status;
		}
	}
	return worst;
}

const IMPACT_TO_STATUS: Record<IncidentImpact, ServiceStatus> = {
	none: "operational",
	minor: "degraded_performance",
	major: "partial_outage",
	critical: "major_outage",
};

/** The service status an incident of a given impact implies. */
export function impactToStatus(impact: IncidentImpact): ServiceStatus {
	return IMPACT_TO_STATUS[impact];
}

export function isClosedStatus(status: EventStatus): boolean {
	return status === "resolved" || status === "completed";
}

export function isOpen(incident: Pick<Incident, "status">): boolean {
	return !isClosedStatus(incident.status);
}

export function initialStatus(kind: IncidentKind): EventStatus {
	return kind === "incident" ? "investigating" : "scheduled";
}

export function closedStatus(kind: IncidentKind): EventStatus {
	return kind === "incident" ? "resolved" : "completed";
}

export function roleRank(role: Role): number {
	return ROLES.indexOf(role);
}

export function hasRole(role: Role, required: Role): boolean {
	return roleRank(role) >= roleRank(required);
}

/** Downtime weight used for uptime percentages (Statuspage-compatible). */
export const DOWNTIME_WEIGHT: Record<ServiceStatus, number> = {
	operational: 0,
	under_maintenance: 0,
	degraded_performance: 0,
	partial_outage: 0.3,
	major_outage: 1,
};
