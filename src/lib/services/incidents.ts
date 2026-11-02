import { createId } from "../crypto";
import {
	type CreateIncidentInput,
	createIncidentSchema,
	type EditIncidentInput,
	editIncidentSchema,
	type IncidentUpdateInput,
	incidentUpdateSchema,
} from "../domain/schemas";
import {
	impactToStatus,
	initialStatus,
	isClosedStatus,
} from "../domain/status";
import {
	type Actor,
	type Component,
	type ComponentStatus,
	type EventStatus,
	INCIDENT_STATUSES,
	type Incident,
	type IncidentKind,
	type IncidentUpdate,
	MAINTENANCE_STATUSES,
} from "../domain/types";
import { NotFoundError, ValidationError } from "../errors";
import type { NotificationEvent } from "../notifications/templates";
import type { Condition } from "../store/types";
import type { ComponentService } from "./components";
import {
	authorRef,
	iso,
	parse,
	requireRole,
	type ServiceContext,
} from "./context";
import type { SettingsService } from "./settings";
import type { SubscriberService } from "./subscribers";

export const OPEN_STATUSES: readonly EventStatus[] = [
	"investigating",
	"identified",
	"monitoring",
	"scheduled",
	"in_progress",
	"verifying",
];
export const CLOSED_STATUSES: readonly EventStatus[] = [
	"resolved",
	"completed",
];

export interface IncidentListOptions {
	kind?: IncidentKind;
	/** `true` for open events only, `false` for closed events only. */
	open?: boolean;
	/** ISO timestamp: only events created at or after this time. */
	since?: string;
	/** ISO timestamp: only events created before this time. */
	before?: string;
	limit?: number;
}

interface ComponentPlan {
	status: ComponentStatus;
	restore: boolean;
}

function assertStatusForKind(kind: IncidentKind, status: EventStatus): void {
	const allowed: readonly EventStatus[] =
		kind === "incident" ? INCIDENT_STATUSES : MAINTENANCE_STATUSES;
	if (!allowed.includes(status)) {
		throw new ValidationError(
			`Status "${status}" is not valid for ${kind}. Use one of: ${allowed.join(", ")}`,
		);
	}
}

function assertWindow(start?: string, end?: string): void {
	if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
		throw new ValidationError("scheduledEnd must be after scheduledStart");
	}
}

export class IncidentService {
	private readonly ctx: ServiceContext;
	private readonly components: ComponentService;
	private readonly subscribers: SubscriberService;
	private readonly settings: SettingsService;

	constructor(
		ctx: ServiceContext,
		components: ComponentService,
		subscribers: SubscriberService,
		settings: SettingsService,
	) {
		this.ctx = ctx;
		this.components = components;
		this.subscribers = subscribers;
		this.settings = settings;
	}

	async list(options: IncidentListOptions = {}): Promise<Incident[]> {
		const where: Condition[] = [];
		if (options.kind) {
			where.push({ field: "kind", op: "eq", value: options.kind });
		}
		if (options.open !== undefined) {
			where.push({
				field: "status",
				op: "in",
				value: options.open ? OPEN_STATUSES : CLOSED_STATUSES,
			});
		}
		if (options.since) {
			where.push({ field: "createdAt", op: "gte", value: options.since });
		}
		if (options.before) {
			where.push({ field: "createdAt", op: "lt", value: options.before });
		}
		return this.ctx.store.find("incidents", {
			where,
			sort: [{ field: "createdAt", direction: "desc" }],
			limit: options.limit,
		});
	}

	async find(id: string): Promise<Incident | undefined> {
		return this.ctx.store.get("incidents", id);
	}

	async get(id: string): Promise<Incident> {
		const incident = await this.find(id);
		if (!incident) {
			throw new NotFoundError("Incident", id);
		}
		return incident;
	}

	/** Components referenced by an incident that still exist. */
	async affectedComponents(incident: Incident): Promise<Component[]> {
		const components = await this.components.list();
		return components.filter((component) =>
			incident.componentIds.includes(component.id),
		);
	}

	async create(actor: Actor, input: CreateIncidentInput): Promise<Incident> {
		requireRole(actor, "editor");
		const data = parse(createIncidentSchema, input);
		const kind = data.kind ?? "incident";
		const status = data.status ?? initialStatus(kind);
		assertStatusForKind(kind, status);
		if (
			kind === "maintenance" &&
			(!data.scheduledStart || !data.scheduledEnd)
		) {
			throw new ValidationError(
				"Maintenance requires scheduledStart and scheduledEnd",
			);
		}
		assertWindow(data.scheduledStart, data.scheduledEnd);
		const componentIds = await this.validateComponents(data.componentIds ?? []);
		const now = iso(this.ctx.now());
		const author = authorRef(actor);
		const update: IncidentUpdate = {
			id: createId("upd"),
			status,
			message: data.message,
			author,
			createdAt: now,
		};
		const incident: Incident = {
			id: createId(kind === "incident" ? "inc" : "mnt"),
			kind,
			title: data.title,
			status,
			impact: data.impact ?? (kind === "incident" ? "minor" : "none"),
			componentIds,
			updates: [update],
			startedAt: data.scheduledStart ?? now,
			createdBy: author,
			createdAt: now,
			updatedAt: now,
		};
		if (kind === "maintenance") {
			incident.scheduledStart = data.scheduledStart;
			incident.scheduledEnd = data.scheduledEnd;
		}
		if (isClosedStatus(status)) {
			incident.resolvedAt = now;
		}
		await this.ctx.store.insert("incidents", incident);
		await this.syncComponents(
			incident,
			this.plan(incident, data.componentStatus, true),
		);
		await this.notify(
			kind === "incident" ? "incident.created" : "maintenance.scheduled",
			incident,
			update,
			data.notify,
		);
		return incident;
	}

	/** Posts a timeline update (and optionally a status change) to an incident. */
	async postUpdate(
		actor: Actor,
		id: string,
		input: IncidentUpdateInput,
	): Promise<Incident> {
		requireRole(actor, "editor");
		const data = parse(incidentUpdateSchema, input);
		const current = await this.load(id);
		const status = data.status ?? current.status;
		assertStatusForKind(current.kind, status);
		const now = iso(this.ctx.now());
		const update: IncidentUpdate = {
			id: createId("upd"),
			status,
			message: data.message,
			author: authorRef(actor),
			createdAt: now,
		};
		const next: Incident = {
			...current,
			status,
			updates: [...current.updates, update],
			updatedAt: now,
		};
		const closing = isClosedStatus(status);
		if (closing) {
			next.resolvedAt = current.resolvedAt ?? now;
		} else {
			delete next.resolvedAt;
		}
		await this.ctx.store.update("incidents", next);
		const wasClosed = isClosedStatus(current.status);
		const plan =
			closing && wasClosed && !data.componentStatus
				? undefined
				: this.plan(next, data.componentStatus, false);
		await this.syncComponents(next, plan);
		const event: NotificationEvent =
			next.kind === "incident"
				? closing && !wasClosed
					? "incident.resolved"
					: "incident.updated"
				: closing && !wasClosed
					? "maintenance.completed"
					: "maintenance.updated";
		await this.notify(event, next, update, data.notify);
		return next;
	}

	/** Shortcut for posting a closing update. */
	async resolve(actor: Actor, id: string, message?: string): Promise<Incident> {
		const incident = await this.load(id);
		return this.postUpdate(actor, id, {
			status: incident.kind === "incident" ? "resolved" : "completed",
			message:
				message ??
				(incident.kind === "incident"
					? "This incident has been resolved."
					: "This maintenance has been completed."),
		});
	}

	/** Edits incident metadata without posting a timeline update. */
	async edit(
		actor: Actor,
		id: string,
		input: EditIncidentInput,
	): Promise<Incident> {
		requireRole(actor, "editor");
		const patch = parse(editIncidentSchema, input);
		const current = await this.load(id);
		const next: Incident = {
			...current,
			title: patch.title ?? current.title,
			impact: patch.impact ?? current.impact,
			componentIds: patch.componentIds
				? await this.validateComponents(patch.componentIds)
				: current.componentIds,
			updatedAt: iso(this.ctx.now()),
		};
		if (current.kind === "maintenance") {
			const scheduledStart =
				patch.scheduledStart ?? (current.scheduledStart as string);
			next.scheduledStart = scheduledStart;
			next.scheduledEnd = patch.scheduledEnd ?? current.scheduledEnd;
			next.startedAt = scheduledStart;
			assertWindow(next.scheduledStart, next.scheduledEnd);
		}
		await this.ctx.store.update("incidents", next);
		return next;
	}

	async delete(actor: Actor, id: string): Promise<void> {
		requireRole(actor, "editor");
		if (!(await this.ctx.store.delete("incidents", id))) {
			throw new NotFoundError("Incident", id);
		}
	}

	private async load(id: string): Promise<Incident> {
		const incident = await this.ctx.store.get("incidents", id, {
			consistent: true,
		});
		if (!incident) {
			throw new NotFoundError("Incident", id);
		}
		return incident;
	}

	private async validateComponents(ids: readonly string[]): Promise<string[]> {
		const unique = [...new Set(ids)];
		for (const id of unique) {
			await this.components.get(id);
		}
		return unique;
	}

	/** Decides which status (if any) the affected components should move to. */
	private plan(
		incident: Incident,
		explicit: ComponentStatus | undefined,
		isNew: boolean,
	): ComponentPlan | undefined {
		if (explicit) {
			return { status: explicit, restore: false };
		}
		if (isClosedStatus(incident.status)) {
			return { status: "operational", restore: true };
		}
		if (incident.kind === "maintenance") {
			return incident.status === "in_progress"
				? { status: "under_maintenance", restore: false }
				: undefined;
		}
		return isNew && incident.impact !== "none"
			? { status: impactToStatus(incident.impact), restore: false }
			: undefined;
	}

	private async syncComponents(
		incident: Incident,
		plan: ComponentPlan | undefined,
	): Promise<void> {
		if (!plan || incident.componentIds.length === 0) {
			return;
		}
		const others = plan.restore
			? (await this.list({ open: true })).filter(
					(other) => other.id !== incident.id,
				)
			: [];
		for (const componentId of incident.componentIds) {
			const component = await this.ctx.store.get("components", componentId, {
				consistent: true,
			});
			if (!component) {
				continue;
			}
			if (others.some((other) => other.componentIds.includes(componentId))) {
				continue;
			}
			await this.components.applyStatus(component, plan.status, incident.id);
		}
	}

	private async notify(
		event: NotificationEvent,
		incident: Incident,
		update: IncidentUpdate,
		enabled: boolean | undefined,
	): Promise<void> {
		if (enabled === false) {
			return;
		}
		try {
			const subscribers = await this.subscribers.recipients();
			if (subscribers.length === 0) {
				return;
			}
			await this.ctx.notifier.notifyIncident(
				{
					event,
					incident,
					update,
					settings: await this.settings.get(),
					components: await this.affectedComponents(incident),
				},
				subscribers,
			);
		} catch (error) {
			console.error(
				`[notifications] failed to notify for ${incident.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
