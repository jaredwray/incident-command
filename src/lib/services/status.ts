import { impactToStatus, worstStatus } from "../domain/status";
import type {
	Component,
	ComponentStatus,
	Incident,
	Settings,
} from "../domain/types";
import {
	computeUptime,
	DAY_MS,
	type DayStatus,
	type UptimeWindow,
	uptimeWindow,
} from "../domain/uptime";
import type { ComponentService } from "./components";
import type { ServiceContext } from "./context";
import type { IncidentService } from "./incidents";
import type { SettingsService } from "./settings";

export const RECENT_DAYS = 14;

export interface ComponentView extends Component {
	uptime: number | null;
	days: DayStatus[];
}

export interface ComponentGroupView {
	name: string | null;
	status: ComponentStatus;
	components: ComponentView[];
}

export interface StatusSummary {
	settings: Settings;
	overall: ComponentStatus;
	groups: ComponentGroupView[];
	components: ComponentView[];
	activeIncidents: Incident[];
	activeMaintenance: Incident[];
	upcomingMaintenance: Incident[];
	recentIncidents: Incident[];
	window: UptimeWindow;
	generatedAt: string;
}

export interface HistoryMonth {
	/** `YYYY-MM` */
	key: string;
	incidents: Incident[];
}

export interface HistoryPage {
	months: HistoryMonth[];
	/** Key of the page with older months. */
	older: string;
	/** Key of the page with newer months, or `null` for the latest page. */
	newer: string | null;
}

function monthKey(date: Date): string {
	return date.toISOString().slice(0, 7);
}

function addMonths(key: string, delta: number): string {
	const [year, month] = key.split("-").map(Number) as [number, number];
	return monthKey(new Date(Date.UTC(year, month - 1 + delta, 1)));
}

function monthStart(key: string): string {
	return `${key}-01T00:00:00.000Z`;
}

/** Builds the read models the public status page and API render. */
export class StatusService {
	private readonly ctx: ServiceContext;
	private readonly settings: SettingsService;
	private readonly components: ComponentService;
	private readonly incidents: IncidentService;

	constructor(
		ctx: ServiceContext,
		settings: SettingsService,
		components: ComponentService,
		incidents: IncidentService,
	) {
		this.ctx = ctx;
		this.settings = settings;
		this.components = components;
		this.incidents = incidents;
	}

	async summary(): Promise<StatusSummary> {
		const settings = await this.settings.get();
		const now = this.ctx.now();
		const window = uptimeWindow(now, settings.uptimeDays);
		const since = new Date(
			Math.min(window.start.getTime(), now.getTime() - RECENT_DAYS * DAY_MS),
		).toISOString();
		const [components, changes, open, recent] = await Promise.all([
			this.components.list({ includeHidden: false }),
			this.ctx.store.find("component_status_changes", {
				where: [
					{ field: "createdAt", op: "gte", value: window.start.toISOString() },
				],
				sort: [{ field: "createdAt" }],
			}),
			this.incidents.list({ open: true }),
			this.incidents.list({ since }),
		]);
		const byId = new Map<string, Incident>();
		for (const incident of [...open, ...recent]) {
			byId.set(incident.id, incident);
		}
		const relevant = [...byId.values()];

		const views: ComponentView[] = components.map((component) => ({
			...component,
			...computeUptime(component, changes, relevant, window),
		}));

		const groups: ComponentGroupView[] = [];
		for (const view of views) {
			const name = view.group ?? null;
			let group = groups.find((candidate) => candidate.name === name);
			if (!group) {
				group = { name, status: "operational", components: [] };
				groups.push(group);
			}
			group.components.push(view);
			group.status = worstStatus(group.components.map((c) => c.status));
		}

		const activeIncidents = open.filter(
			(incident) => incident.kind === "incident",
		);
		const activeMaintenance = open.filter(
			(incident) =>
				incident.kind === "maintenance" && incident.status !== "scheduled",
		);
		const upcomingMaintenance = open
			.filter(
				(incident) =>
					incident.kind === "maintenance" && incident.status === "scheduled",
			)
			.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
		const recentCutoff = new Date(
			now.getTime() - RECENT_DAYS * DAY_MS,
		).toISOString();
		const recentIncidents = recent.filter(
			(incident) =>
				incident.createdAt >= recentCutoff && incident.status !== "scheduled",
		);

		const overall = worstStatus([
			...views.map((view) => view.status),
			...activeIncidents.map((incident) => impactToStatus(incident.impact)),
			...activeMaintenance.map((): ComponentStatus => "under_maintenance"),
		]);

		return {
			settings,
			overall,
			groups,
			components: views,
			activeIncidents,
			activeMaintenance,
			upcomingMaintenance,
			recentIncidents,
			window,
			generatedAt: now.toISOString(),
		};
	}

	/**
	 * Incident history paginated by month. `month` (`YYYY-MM`) is the newest
	 * month on the page; defaults to the current month.
	 */
	async history(month?: string, months = 3): Promise<HistoryPage> {
		const current = monthKey(this.ctx.now());
		const newest =
			month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month < current
				? month
				: current;
		const oldest = addMonths(newest, -(months - 1));
		const incidents = (
			await this.incidents.list({
				since: monthStart(oldest),
				before: monthStart(addMonths(newest, 1)),
			})
		).filter((incident) => incident.status !== "scheduled");
		const result: HistoryMonth[] = [];
		for (let offset = 0; offset < months; offset++) {
			const key = addMonths(newest, -offset);
			result.push({
				key,
				incidents: incidents.filter((incident) =>
					incident.createdAt.startsWith(key),
				),
			});
		}
		const newer = addMonths(newest, months);
		return {
			months: result,
			older: addMonths(oldest, -1),
			newer:
				newest === current
					? null
					: newer.localeCompare(current) > 0
						? current
						: newer,
		};
	}
}
