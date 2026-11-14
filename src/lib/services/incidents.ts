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
	type EventStatus,
	INCIDENT_STATUSES,
	type Incident,
	type IncidentKind,
	type IncidentUpdate,
	MAINTENANCE_STATUSES,
	type Service,
	type ServiceStatus,
} from "../domain/types";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { NotificationEvent } from "../notifications/templates";
import type { Condition, ReadOptions } from "../store/types";
import type { ServiceCatalog } from "./catalog";
import {
	authorRef,
	iso,
	parse,
	requireRole,
	type ServiceContext,
} from "./context";
import type { NotificationSettingsService } from "./notification-settings";
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

const MAX_WRITE_ATTEMPTS = 5;

/** A new id for an incident (`inc_`) or maintenance (`mnt_`). */
export function newIncidentId(kind: IncidentKind): string {
	return createId(kind === "incident" ? "inc" : "mnt");
}

export interface PublishOptions {
	/**
	 * The id of the new incident or update. A caller that sets it can find
	 * the record when a later step of the publication fails.
	 */
	id?: string;
}

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

interface ServicePlan {
	status: ServiceStatus;
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
	private readonly catalog: ServiceCatalog;
	private readonly subscribers: SubscriberService;
	private readonly settings: SettingsService;
	private readonly notificationSettings: NotificationSettingsService;

	constructor(
		ctx: ServiceContext,
		catalog: ServiceCatalog,
		subscribers: SubscriberService,
		settings: SettingsService,
		notificationSettings: NotificationSettingsService,
	) {
		this.ctx = ctx;
		this.catalog = catalog;
		this.subscribers = subscribers;
		this.settings = settings;
		this.notificationSettings = notificationSettings;
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

	async find(id: string, options?: ReadOptions): Promise<Incident | undefined> {
		return this.ctx.store.get("incidents", id, options);
	}

	async get(id: string): Promise<Incident> {
		const incident = await this.find(id);
		if (!incident) {
			throw new NotFoundError("Incident", id);
		}
		return incident;
	}

	/** Services referenced by an incident that still exist. */
	async affectedServices(incident: Incident): Promise<Service[]> {
		const services = await this.catalog.list();
		return services.filter((service) =>
			incident.serviceIds.includes(service.id),
		);
	}

	/**
	 * Checks a new incident or maintenance as `create` does, but saves
	 * nothing. Returns the parsed input without duplicate service ids.
	 */
	async check(input: CreateIncidentInput) {
		const data = parse(createIncidentSchema, input);
		const kind = data.kind ?? "incident";
		assertStatusForKind(kind, data.status ?? initialStatus(kind));
		if (
			kind === "maintenance" &&
			(!data.scheduledStart || !data.scheduledEnd)
		) {
			throw new ValidationError(
				"Maintenance requires scheduledStart and scheduledEnd",
			);
		}
		assertWindow(data.scheduledStart, data.scheduledEnd);
		const serviceIds = await this.validateServices(data.serviceIds ?? []);
		return { ...data, serviceIds };
	}

	/**
	 * Checks an update for an incident as `postUpdate` does, but saves
	 * nothing. Returns the incident and the parsed input.
	 */
	async checkUpdate(id: string, input: IncidentUpdateInput) {
		const data = parse(incidentUpdateSchema, input);
		const incident = await this.get(id);
		if (data.status) {
			assertStatusForKind(incident.kind, data.status);
		}
		return { incident, data };
	}

	async create(
		actor: Actor,
		input: CreateIncidentInput,
		options: PublishOptions = {},
	): Promise<Incident> {
		requireRole(actor, "editor");
		const data = await this.check(input);
		const kind = data.kind ?? "incident";
		const status = data.status ?? initialStatus(kind);
		const serviceIds = data.serviceIds;
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
			id: options.id ?? newIncidentId(kind),
			kind,
			title: data.title,
			status,
			impact: data.impact ?? (kind === "incident" ? "minor" : "none"),
			serviceIds,
			updates: [update],
			startedAt: data.scheduledStart ?? now,
			revision: 1,
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
		await this.syncServices(
			incident,
			this.plan(incident, data.serviceStatus, true),
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
		options: PublishOptions = {},
	): Promise<Incident> {
		requireRole(actor, "editor");
		const data = parse(incidentUpdateSchema, input);
		const author = authorRef(actor);
		const updateId = options.id ?? createId("upd");
		const { current, next } = await this.mutate(id, (current) => {
			const status = data.status ?? current.status;
			assertStatusForKind(current.kind, status);
			const now = iso(this.ctx.now());
			const next: Incident = {
				...current,
				status,
				updates: [
					...current.updates,
					{
						id: updateId,
						status,
						message: data.message,
						author,
						createdAt: now,
					},
				],
				updatedAt: now,
			};
			if (isClosedStatus(status)) {
				next.resolvedAt = current.resolvedAt ?? now;
			} else {
				delete next.resolvedAt;
			}
			return next;
		});
		const update = next.updates.at(-1) as IncidentUpdate;
		const closing = isClosedStatus(next.status);
		const wasClosed = isClosedStatus(current.status);
		const plan =
			closing && wasClosed && !data.serviceStatus
				? undefined
				: this.plan(next, data.serviceStatus, false);
		await this.syncServices(next, plan);
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
		const serviceIds = patch.serviceIds
			? await this.validateServices(patch.serviceIds)
			: undefined;
		const { next } = await this.mutate(id, (current) => {
			const next: Incident = {
				...current,
				title: patch.title ?? current.title,
				impact: patch.impact ?? current.impact,
				serviceIds: serviceIds ?? current.serviceIds,
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
			return next;
		});
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

	/**
	 * Applies a change with optimistic concurrency: the write only succeeds if
	 * nobody saved the incident since it was read, otherwise it is retried on
	 * the latest version so concurrent updates never overwrite each other.
	 */
	private async mutate(
		id: string,
		change: (current: Incident) => Incident,
	): Promise<{ current: Incident; next: Incident }> {
		for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
			const current = await this.load(id);
			const revision = current.revision ?? 0;
			const next: Incident = { ...change(current), revision: revision + 1 };
			const saved = await this.ctx.store.update("incidents", next, {
				where: [
					{ field: "revision", op: "eq", value: current.revision ?? null },
				],
			});
			if (saved) {
				return { current, next };
			}
		}
		throw new ConflictError(
			"The incident is being changed by someone else. Please try again.",
		);
	}

	private async validateServices(ids: readonly string[]): Promise<string[]> {
		const unique = [...new Set(ids)];
		for (const id of unique) {
			await this.catalog.get(id);
		}
		return unique;
	}

	/** Decides which status (if any) the affected services should move to. */
	private plan(
		incident: Incident,
		explicit: ServiceStatus | undefined,
		isNew: boolean,
	): ServicePlan | undefined {
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

	private async syncServices(
		incident: Incident,
		plan: ServicePlan | undefined,
	): Promise<void> {
		if (!plan || incident.serviceIds.length === 0) {
			return;
		}
		const others = plan.restore
			? (await this.list({ open: true })).filter(
					// scheduled maintenance has not touched any service yet
					(other) => other.id !== incident.id && other.status !== "scheduled",
				)
			: [];
		for (const serviceId of incident.serviceIds) {
			const service = await this.ctx.store.get("services", serviceId, {
				consistent: true,
			});
			if (!service) {
				continue;
			}
			if (others.some((other) => other.serviceIds.includes(serviceId))) {
				continue;
			}
			await this.catalog.applyStatus(service, plan.status, incident.id);
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
					services: await this.affectedServices(incident),
				},
				subscribers,
				await this.notificationSettings.resolve(),
			);
		} catch (error) {
			console.error(
				`[notifications] failed to notify for ${incident.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
