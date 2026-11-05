import { OVERALL_STATUS_COPY } from "./domain/status";
import type { Incident } from "./domain/types";
import type { StatusSummary } from "./services/status";

function publicIncident(incident: Incident, visible: Set<string>) {
	return {
		id: incident.id,
		kind: incident.kind,
		title: incident.title,
		status: incident.status,
		impact: incident.impact,
		services: incident.serviceIds.filter((id) => visible.has(id)),
		startedAt: incident.startedAt,
		resolvedAt: incident.resolvedAt ?? null,
		scheduledStart: incident.scheduledStart ?? null,
		scheduledEnd: incident.scheduledEnd ?? null,
		updates: [...incident.updates].reverse().map((update) => ({
			id: update.id,
			status: update.status,
			message: update.message,
			createdAt: update.createdAt,
		})),
	};
}

/** The public JSON representation of the status page (no internal fields). */
export function buildPublicStatus(summary: StatusSummary) {
	const visible = new Set(summary.services.map((service) => service.id));
	const toPublic = (incident: Incident) => publicIncident(incident, visible);
	return {
		page: {
			name: summary.settings.siteName,
			url: summary.settings.siteUrl ?? null,
		},
		status: {
			indicator: summary.overall,
			description: OVERALL_STATUS_COPY[summary.overall].title,
		},
		services: summary.services.map((service) => ({
			id: service.id,
			name: service.name,
			description: service.description ?? null,
			group: service.group ?? null,
			status: service.status,
			uptime: service.uptime,
		})),
		incidents: summary.activeIncidents.map(toPublic),
		maintenance: {
			active: summary.activeMaintenance.map(toPublic),
			upcoming: summary.upcomingMaintenance.map(toPublic),
		},
		generatedAt: summary.generatedAt,
	};
}
