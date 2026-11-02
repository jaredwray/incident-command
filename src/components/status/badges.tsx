import {
	COMPONENT_STATUS_LABELS,
	EVENT_STATUS_LABELS,
	IMPACT_LABELS,
	impactToStatus,
	isClosedStatus,
} from "@/lib/domain/status";
import type {
	ComponentStatus,
	EventStatus,
	IncidentImpact,
	IncidentKind,
} from "@/lib/domain/types";

export const STATUS_BG: Record<ComponentStatus, string> = {
	operational: "bg-operational",
	under_maintenance: "bg-maintenance",
	degraded_performance: "bg-degraded",
	partial_outage: "bg-partial",
	major_outage: "bg-major",
};

export const STATUS_TEXT: Record<ComponentStatus, string> = {
	operational: "text-operational",
	under_maintenance: "text-maintenance",
	degraded_performance: "text-degraded",
	partial_outage: "text-partial",
	major_outage: "text-major",
};

const pill =
	"inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function StatusDot({ status }: { status: ComponentStatus }) {
	return (
		<span
			className={`inline-block size-2 shrink-0 rounded-full ${STATUS_BG[status]}`}
			aria-hidden
		/>
	);
}

export function StatusBadge({ status }: { status: ComponentStatus }) {
	return (
		<span className={pill}>
			<StatusDot status={status} />
			{COMPONENT_STATUS_LABELS[status]}
		</span>
	);
}

/** Color for an incident or maintenance, by kind, impact and status. */
export function eventColorStatus(
	kind: IncidentKind,
	impact: IncidentImpact,
	status: EventStatus,
): ComponentStatus {
	if (isClosedStatus(status)) {
		return "operational";
	}
	return kind === "maintenance" ? "under_maintenance" : impactToStatus(impact);
}

export function EventStatusBadge({
	kind,
	impact,
	status,
}: {
	kind: IncidentKind;
	impact: IncidentImpact;
	status: EventStatus;
}) {
	return (
		<span className={pill}>
			<StatusDot status={eventColorStatus(kind, impact, status)} />
			{EVENT_STATUS_LABELS[status]}
		</span>
	);
}

export function ImpactBadge({ impact }: { impact: IncidentImpact }) {
	return (
		<span className={pill}>
			<StatusDot status={impactToStatus(impact)} />
			{IMPACT_LABELS[impact]} impact
		</span>
	);
}
