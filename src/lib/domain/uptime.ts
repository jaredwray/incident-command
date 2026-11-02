import { DOWNTIME_WEIGHT, statusSeverity } from "./status";
import type {
	Component,
	ComponentStatus,
	ComponentStatusChange,
	Incident,
	IncidentImpact,
} from "./types";

export const DAY_MS = 86_400_000;

export interface DayIncident {
	id: string;
	title: string;
	impact: IncidentImpact;
}

export interface DayStatus {
	/** UTC date, `YYYY-MM-DD`. */
	date: string;
	/** Worst status during the day, or `null` when there is no data (before the component existed). */
	status: ComponentStatus | null;
	/** Fraction between 0 and 1, or `null` when there is no data. */
	uptime: number | null;
	incidents: DayIncident[];
}

export interface UptimeResult {
	uptime: number | null;
	days: DayStatus[];
}

export interface UptimeWindow {
	start: Date;
	end: Date;
	days: number;
}

export function startOfUtcDay(date: Date): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
}

export function toDateKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** The window of `days` whole UTC days ending with today (until `now`). */
export function uptimeWindow(now: Date, days: number): UptimeWindow {
	const start = new Date(startOfUtcDay(now).getTime() - (days - 1) * DAY_MS);
	return { start, end: now, days };
}

interface Segment {
	status: ComponentStatus;
	start: number;
	end: number;
}

function buildSegments(
	component: Component,
	changes: readonly ComponentStatusChange[],
	window: UptimeWindow,
): Segment[] {
	const sorted = [...changes]
		.filter((change) => change.componentId === component.id)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const segments: Segment[] = [];
	let cursor = Math.max(
		window.start.getTime(),
		new Date(component.createdAt).getTime(),
	);
	let status = sorted[0]?.previousStatus ?? component.status;
	for (const change of sorted) {
		const at = new Date(change.createdAt).getTime();
		if (at > cursor) {
			segments.push({ status, start: cursor, end: at });
			cursor = at;
		}
		status = change.status;
	}
	const end = window.end.getTime();
	if (end > cursor) {
		segments.push({ status, start: cursor, end });
	}
	return segments;
}

/**
 * Computes the uptime of a component across a window of days from its status
 * change history. Partial outages count as 30% downtime and major outages as
 * 100%; degraded performance and maintenance do not count as downtime.
 */
export function computeUptime(
	component: Component,
	changes: readonly ComponentStatusChange[],
	incidents: readonly Incident[],
	window: UptimeWindow,
): UptimeResult {
	const segments = buildSegments(component, changes, window);
	const affecting = incidents.filter(
		(incident) =>
			incident.kind === "incident" &&
			incident.componentIds.includes(component.id),
	);
	const now = window.end.getTime();
	let totalTracked = 0;
	let totalDown = 0;
	const days: DayStatus[] = [];

	for (let index = 0; index < window.days; index++) {
		const dayStart = window.start.getTime() + index * DAY_MS;
		const dayEnd = Math.min(dayStart + DAY_MS, now);
		let tracked = 0;
		let down = 0;
		let worst: ComponentStatus | null = null;
		for (const segment of segments) {
			const overlap =
				Math.min(segment.end, dayEnd) - Math.max(segment.start, dayStart);
			if (overlap <= 0) {
				continue;
			}
			tracked += overlap;
			down += overlap * DOWNTIME_WEIGHT[segment.status];
			if (
				worst === null ||
				statusSeverity(segment.status) > statusSeverity(worst)
			) {
				worst = segment.status;
			}
		}
		totalTracked += tracked;
		totalDown += down;
		days.push({
			date: toDateKey(new Date(dayStart)),
			status: worst,
			uptime: tracked > 0 ? 1 - down / tracked : null,
			incidents: affecting
				.filter((incident) => {
					const started = new Date(incident.startedAt).getTime();
					const ended = incident.resolvedAt
						? new Date(incident.resolvedAt).getTime()
						: now;
					return started < dayStart + DAY_MS && ended >= dayStart;
				})
				.map(({ id, title, impact }) => ({ id, title, impact })),
		});
	}

	return {
		uptime: totalTracked > 0 ? 1 - totalDown / totalTracked : null,
		days,
	};
}

/** Formats an uptime fraction as a percentage string such as `99.95%`. */
export function formatUptime(uptime: number | null): string {
	if (uptime === null) {
		return "No data";
	}
	const percent = Math.floor(uptime * 10_000 + 1e-6) / 100;
	return `${percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(2)}%`;
}
