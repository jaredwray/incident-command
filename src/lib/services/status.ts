import { impactToStatus, worstStatus } from "../domain/status";
import type {
	Incident,
	Service,
	ServiceStatus,
	Settings,
} from "../domain/types";
import {
	computeUptime,
	DAY_MS,
	type DayStatus,
	type UptimeWindow,
	uptimeWindow,
} from "../domain/uptime";
import type { ServiceCatalog } from "./catalog";
import type { ServiceContext } from "./context";
import type { IncidentService } from "./incidents";
import type { SettingsService } from "./settings";

export const RECENT_DAYS = 14;

export interface ServiceView extends Service {
	uptime: number | null;
	days: DayStatus[];
}

export interface ServiceGroupView {
	name: string | null;
	status: ServiceStatus;
	services: ServiceView[];
}

export interface StatusSummary {
	settings: Settings;
	overall: ServiceStatus;
	groups: ServiceGroupView[];
	services: ServiceView[];
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
	private readonly catalog: ServiceCatalog;
	private readonly incidents: IncidentService;

	constructor(
		ctx: ServiceContext,
		settings: SettingsService,
		catalog: ServiceCatalog,
		incidents: IncidentService,
	) {
		this.ctx = ctx;
		this.settings = settings;
		this.catalog = catalog;
		this.incidents = incidents;
	}

	async summary(): Promise<StatusSummary> {
		const settings = await this.settings.get();
		const now = this.ctx.now();
		const window = uptimeWindow(now, settings.uptimeDays);
		const since = new Date(
			Math.min(window.start.getTime(), now.getTime() - RECENT_DAYS * DAY_MS),
		).toISOString();
		const [services, changes, open, recent] = await Promise.all([
			this.catalog.list({ includeHidden: false }),
			this.ctx.store.find("service_status_changes", {
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

		const views: ServiceView[] = services.map((service) => ({
			...service,
			...computeUptime(service, changes, relevant, window),
		}));

		const groups: ServiceGroupView[] = [];
		for (const view of views) {
			const name = view.group ?? null;
			let group = groups.find((candidate) => candidate.name === name);
			if (!group) {
				group = { name, status: "operational", services: [] };
				groups.push(group);
			}
			group.services.push(view);
			group.status = worstStatus(group.services.map((c) => c.status));
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
			...activeMaintenance.map((): ServiceStatus => "under_maintenance"),
		]);

		return {
			settings,
			overall,
			groups,
			services: views,
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
