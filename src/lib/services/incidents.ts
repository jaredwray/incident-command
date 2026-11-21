import { createId } from "../crypto";
import { boundServiceRegions } from "../domain/regions";
import {
	type CreateIncidentInput,
	createIncidentSchema,
	type DeleteIncidentInput,
	deleteIncidentSchema,
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
	type ServiceRegions,
	type ServiceStatus,
	type ServiceStatusOverride,
	type StoredIncident,
} from "../domain/types";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { NotificationEvent } from "../notifications/templates";
import type { Condition, ReadOptions } from "../store/types";
import type { ServiceCatalog } from "./catalog";
import {
	authorRef,
	iso,
	parse,
	requirePermission,
	type ServiceContext,
} from "./context";
import type { NotificationJobService } from "./notification-jobs";
import type { NotificationSettingsService } from "./notification-settings";
import type { RegionService } from "./regions";
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
	/** The id of the notification job. The portal sets it before the send. */
	jobId?: string;
	/**
	 * `wait` sends before the call returns. `background` returns while the
	 * send continues. A queue ignores this and enqueues the job.
	 */
	delivery?: "wait" | "background";
}

export interface IncidentListOptions {
	kind?: IncidentKind;
	/** `true` for open events only, `false` for closed events only. */
	open?: boolean;
	/** ISO timestamp: only events created at or after this time. */
	since?: string;
	/** ISO timestamp: only events created before this time. */
	before?: string;
	/**
	 * The sort order, newest first. `createdAt` (default) sorts by the
	 * creation time. `updatedAt` sorts by the time of the latest change,
	 * such as a new update or a resolution.
	 */
	orderBy?: "createdAt" | "updatedAt";
	limit?: number;
	/** `true` returns only incidents that left the public view. */
	deleted?: boolean;
}

/** Matches an incident that is still on the public view. */
export const NOT_DELETED: Condition = {
	field: "deletedAt",
	op: "eq",
	value: null,
};

/** Matches an incident that left the public view. */
const ONLY_DELETED: Condition = {
	field: "deletedAt",
	op: "gt",
	value: "",
};

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

/** The most services that one incident can affect. */
const MAX_AFFECTED_SERVICES = 100;

/**
 * Adds services to the current list. A service that is already affected stays.
 * The result keeps the current order, then the new services.
 */
function mergeServiceIds(
	current: readonly string[],
	add: readonly string[],
): string[] {
	const merged = [...current];
	for (const id of add) {
		if (!merged.includes(id)) {
			merged.push(id);
		}
	}
	if (merged.length > MAX_AFFECTED_SERVICES) {
		throw new ValidationError(
			`An incident can affect at most ${MAX_AFFECTED_SERVICES} services.`,
		);
	}
	return merged;
}

/** Checks that each service with its own status is an affected service. */
function assertAffected(
	serviceIds: readonly string[],
	overrides: readonly ServiceStatusOverride[] = [],
): void {
	const extra = overrides
		.map((override) => override.serviceId)
		.filter((id) => !serviceIds.includes(id));
	if (extra.length > 0) {
		throw new ValidationError(
			`serviceStatuses: only an affected service can have its own status. Add ${extra.join(", ")} to the affected services, or remove the status.`,
		);
	}
}

/** Rejects the old single `regionId`. Regions belong to each service. */
function rejectLegacyRegion(input: object): void {
	if (
		"regionId" in input &&
		(input as { regionId?: unknown }).regionId !== undefined
	) {
		throw new ValidationError(
			"regionId: set serviceRegions for each service. No regions means Global.",
		);
	}
}

/** Checks that each region list belongs to an affected service. */
function assertRegionServices(
	serviceIds: readonly string[],
	regions: readonly ServiceRegions[] = [],
): void {
	const extra = regions
		.map((entry) => entry.serviceId)
		.filter((id) => !serviceIds.includes(id));
	if (extra.length > 0) {
		throw new ValidationError(
			`serviceRegions: only an affected service can have regions. Add ${extra.join(", ")} to the affected services, or remove the regions.`,
		);
	}
}

/**
 * Region entries for services that are no longer affected.
 * Uptime still uses these entries.
 */
function historicalRegions(
	incident: Incident,
	serviceIds: readonly string[],
): ServiceRegions[] {
	const source = incident.serviceRegions
		? incident.serviceRegions
		: incident.regionId
			? incident.serviceIds.map((serviceId) => ({
					serviceId,
					regionIds: [incident.regionId as string],
				}))
			: [];
	return source.flatMap((entry) =>
		serviceIds.includes(entry.serviceId)
			? []
			: [
					{
						serviceId: entry.serviceId,
						regionIds: [...new Set(entry.regionIds)],
					},
				],
	);
}

/**
 * Regions for services that this edit did not see.
 * A service added after the read keeps its regions.
 * `null` clears every service.
 */
function regionsForEdit(
	knownIds: readonly string[],
	current: Incident,
	patch: ServiceRegions[] | null | undefined,
	replacesServices: boolean,
): ServiceRegions[] | null | undefined {
	if (replacesServices || patch == null) {
		return patch;
	}
	const known = new Set(knownIds);
	const kept = (current.serviceRegions ?? []).filter(
		(entry) => !known.has(entry.serviceId),
	);
	return [...patch, ...kept];
}

/**
 * Writes `serviceRegions` and drops the old `regionId`.
 * Call this before you change `incident.serviceIds`.
 * `serviceIds` is the list after the write.
 * `replace` uses `patch` as the full list. `null` or `[]` makes every service Global.
 * Omit `patch` to keep the current regions of the services that remain.
 * `merge` sets only the services in `patch`. Other services keep their regions.
 * An empty `regionIds` list makes that service Global.
 * A service that leaves the incident keeps its region entry for uptime.
 * An old incident with no services keeps `regionId` until a service can hold it.
 */
function assignRegions(
	incident: Incident,
	serviceIds: readonly string[],
	patch: readonly ServiceRegions[] | null | undefined,
	mode: "replace" | "merge",
): void {
	const map = new Map<string, string[]>();
	const clearAll =
		mode === "replace" &&
		patch !== undefined &&
		(patch === null || patch.length === 0);
	if (!clearAll && (patch === undefined || mode === "merge")) {
		for (const entry of boundServiceRegions(incident)) {
			if (serviceIds.includes(entry.serviceId)) {
				map.set(entry.serviceId, entry.regionIds);
			}
		}
	}
	if (patch) {
		for (const entry of patch) {
			if (
				!serviceIds.includes(entry.serviceId) ||
				entry.regionIds.length === 0
			) {
				map.delete(entry.serviceId);
				continue;
			}
			map.set(entry.serviceId, entry.regionIds);
		}
	}
	if (!clearAll) {
		for (const entry of historicalRegions(incident, serviceIds)) {
			map.set(entry.serviceId, entry.regionIds);
		}
	}
	const serviceRegions = [...map.entries()].map(([serviceId, regionIds]) => ({
		serviceId,
		regionIds,
	}));
	// An old incident with no services keeps regionId until a service can hold it.
	const keepLegacy =
		serviceRegions.length === 0 &&
		patch === undefined &&
		incident.regionId !== undefined &&
		incident.serviceIds.length === 0 &&
		serviceIds.length === 0;
	if (serviceRegions.length > 0) {
		incident.serviceRegions = serviceRegions;
		delete incident.regionId;
	} else if (!keepLegacy) {
		delete incident.serviceRegions;
		delete incident.regionId;
	}
}

function assertWindow(start?: string, end?: string): void {
	if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
		throw new ValidationError("scheduledEnd must be after scheduledStart");
	}
}

/**
 * Gives each post a title and an impact. A post that omits a field gets the
 * value of the incident. The next write stores those values.
 */
function withPostFields(stored: StoredIncident): Incident {
	return {
		...stored,
		updates: stored.updates.map((update) => ({
			...update,
			title: update.title ?? stored.title,
			impact: update.impact ?? stored.impact,
		})),
	};
}

/**
 * The incident as one post recorded it. The title, the impact and the
 * status come from that post.
 */
export function incidentAsOf(
	stored: StoredIncident,
	updateId: string,
): { incident: Incident; update: IncidentUpdate } | undefined {
	const incident = withPostFields(stored);
	const update = incident.updates.find((item) => item.id === updateId);
	if (!update) {
		return undefined;
	}
	const snapshot: Incident = {
		...incident,
		title: update.title,
		impact: update.impact,
		status: update.status,
	};
	// The time belongs to this post. A later post does not change it.
	if (isClosedStatus(update.status)) {
		snapshot.resolvedAt = update.createdAt;
	} else {
		delete snapshot.resolvedAt;
	}
	return { update, incident: snapshot };
}

export class IncidentService {
	private readonly ctx: ServiceContext;
	private readonly catalog: ServiceCatalog;
	private readonly subscribers: SubscriberService;
	private readonly settings: SettingsService;
	private readonly notificationSettings: NotificationSettingsService;
	private readonly regions: RegionService;
	private readonly jobs: NotificationJobService;

	constructor(
		ctx: ServiceContext,
		catalog: ServiceCatalog,
		subscribers: SubscriberService,
		settings: SettingsService,
		notificationSettings: NotificationSettingsService,
		regions: RegionService,
		jobs: NotificationJobService,
	) {
		this.ctx = ctx;
		this.catalog = catalog;
		this.subscribers = subscribers;
		this.settings = settings;
		this.notificationSettings = notificationSettings;
		this.regions = regions;
		this.jobs = jobs;
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
		where.push(options.deleted ? ONLY_DELETED : NOT_DELETED);
		const stored = await this.ctx.store.find("incidents", {
			where,
			sort: [{ field: options.orderBy ?? "createdAt", direction: "desc" }],
			limit: options.limit,
		});
		return stored.map((incident) => withPostFields(incident));
	}

	async find(
		id: string,
		options?: ReadOptions & { includeDeleted?: boolean },
	): Promise<Incident | undefined> {
		const stored = await this.ctx.store.get("incidents", id, options);
		if (!stored) {
			return undefined;
		}
		const incident = withPostFields(stored);
		if (incident.deletedAt && !options?.includeDeleted) {
			return undefined;
		}
		return incident;
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
		rejectLegacyRegion(input);
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
		assertAffected(serviceIds, data.serviceStatuses);
		const serviceRegions = await this.validateRegions(
			serviceIds,
			data.serviceRegions,
		);
		return { ...data, serviceIds, serviceRegions };
	}

	/**
	 * Checks an update for an incident as `postUpdate` does, but saves
	 * nothing. Returns the incident and the parsed input.
	 */
	async checkUpdate(id: string, input: IncidentUpdateInput) {
		rejectLegacyRegion(input);
		const data = parse(incidentUpdateSchema, input);
		const incident = await this.get(id);
		if (data.status) {
			assertStatusForKind(incident.kind, data.status);
		}
		const addIds = await this.validateServices(data.serviceIds ?? []);
		const serviceIds = mergeServiceIds(incident.serviceIds, addIds);
		assertAffected(serviceIds, data.serviceStatuses);
		const serviceRegions = await this.validateRegions(
			serviceIds,
			data.serviceRegions,
		);
		return {
			incident,
			data: {
				...data,
				serviceIds: addIds.length > 0 ? addIds : undefined,
				serviceRegions,
			},
		};
	}

	async create(
		actor: Actor,
		input: CreateIncidentInput,
		options: PublishOptions = {},
	): Promise<Incident> {
		requirePermission(actor, "incidents.publish");
		const data = await this.check(input);
		this.assertCanNotify(actor, data.notify);
		const kind = data.kind ?? "incident";
		const status = data.status ?? initialStatus(kind);
		const serviceIds = data.serviceIds;
		const now = iso(this.ctx.now());
		const author = authorRef(actor);
		const impact = data.impact ?? (kind === "incident" ? "minor" : "none");
		const update: IncidentUpdate = {
			id: createId("upd"),
			title: data.title,
			impact,
			status,
			message: data.message,
			author,
			notified: data.notify !== false,
			createdAt: now,
		};
		const incident: Incident = {
			id: options.id ?? newIncidentId(kind),
			kind,
			title: data.title,
			status,
			impact,
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
		assignRegions(incident, serviceIds, data.serviceRegions ?? [], "replace");
		await this.ctx.store.insert("incidents", incident);
		await this.syncServices(
			incident,
			this.plan(incident, data.serviceStatus, true),
			data.serviceStatuses,
		);
		await this.notify(
			actor,
			kind === "incident" ? "incident.created" : "maintenance.scheduled",
			incident,
			update,
			data.notify,
			options,
		);
		return incident;
	}

	/** Posts a timeline update. It can change the title, the impact and the status. It can add services. */
	async postUpdate(
		actor: Actor,
		id: string,
		input: IncidentUpdateInput,
		options: PublishOptions = {},
	): Promise<Incident> {
		requirePermission(actor, "incidents.publish");
		rejectLegacyRegion(input);
		const data = parse(incidentUpdateSchema, input);
		this.assertCanNotify(actor, data.notify);
		const addIds = await this.validateServices(data.serviceIds ?? []);
		const existing = await this.load(id);
		const serviceRegions = await this.validateRegions(
			mergeServiceIds(existing.serviceIds, addIds),
			data.serviceRegions,
		);
		const author = authorRef(actor);
		const updateId = options.id ?? createId("upd");
		const { current, next } = await this.mutate(id, (current) => {
			const status = data.status ?? current.status;
			const title = data.title ?? current.title;
			const impact = data.impact ?? current.impact;
			assertStatusForKind(current.kind, status);
			const serviceIds = mergeServiceIds(current.serviceIds, addIds);
			assertAffected(serviceIds, data.serviceStatuses);
			const now = iso(this.ctx.now());
			const next: Incident = {
				...current,
				title,
				impact,
				status,
				updates: [
					...current.updates,
					{
						id: updateId,
						title,
						impact,
						status,
						message: data.message,
						author,
						notified: data.notify !== false,
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
			assignRegions(next, serviceIds, serviceRegions, "merge");
			next.serviceIds = serviceIds;
			return next;
		});
		const update = next.updates.at(-1) as IncidentUpdate;
		const closing = isClosedStatus(next.status);
		const wasClosed = isClosedStatus(current.status);
		const plan =
			closing && wasClosed && !data.serviceStatus
				? undefined
				: this.plan(next, data.serviceStatus, false);
		const added = new Set(
			next.serviceIds.filter(
				(serviceId) => !current.serviceIds.includes(serviceId),
			),
		);
		await this.syncServices(next, plan, data.serviceStatuses, added);
		const event: NotificationEvent =
			next.kind === "incident"
				? closing && !wasClosed
					? "incident.resolved"
					: "incident.updated"
				: closing && !wasClosed
					? "maintenance.completed"
					: "maintenance.updated";
		await this.notify(actor, event, next, update, data.notify, options);
		return next;
	}

	/** Shortcut for posting a closing update. */
	async resolve(
		actor: Actor,
		id: string,
		message?: string,
		notify?: boolean,
	): Promise<Incident> {
		const incident = await this.load(id);
		return this.postUpdate(actor, id, {
			status: incident.kind === "incident" ? "resolved" : "completed",
			message:
				message ??
				(incident.kind === "incident"
					? "This incident has been resolved."
					: "This maintenance has been completed."),
			...(notify === undefined ? {} : { notify }),
		});
	}

	/** Edits incident metadata without posting a timeline update. */
	async edit(
		actor: Actor,
		id: string,
		input: EditIncidentInput,
	): Promise<Incident> {
		requirePermission(actor, "incidents.edit");
		rejectLegacyRegion(input);
		const patch = parse(editIncidentSchema, input);
		const validatedIds = patch.serviceIds
			? await this.validateServices(patch.serviceIds)
			: undefined;
		const read = await this.get(id);
		const serviceRegions = await this.validateRegions(
			validatedIds ?? read.serviceIds,
			patch.serviceRegions,
		);
		const { next } = await this.mutate(id, (current) => {
			const next: Incident = {
				...current,
				updatedAt: iso(this.ctx.now()),
			};
			const serviceIds = validatedIds ?? current.serviceIds;
			assignRegions(
				next,
				serviceIds,
				regionsForEdit(
					read.serviceIds,
					current,
					serviceRegions,
					validatedIds !== undefined,
				),
				"replace",
			);
			if (validatedIds) {
				next.serviceIds = serviceIds;
			}
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

	/**
	 * Removes an incident from the public view. The portal keeps the incident,
	 * the posts, and a record of who deleted it and why.
	 */
	async delete(
		actor: Actor,
		id: string,
		input: DeleteIncidentInput,
	): Promise<void> {
		requirePermission(actor, "incidents.delete");
		const { reason } = parse(deleteIncidentSchema, input);
		if (!reason) {
			throw new ValidationError(
				"Write a reason before you delete the incident.",
			);
		}
		const deletedAt = iso(this.ctx.now());
		await this.mutate(id, (current) => ({
			...current,
			deletedAt,
			deletedBy: authorRef(actor),
			deletedReason: reason,
			updatedAt: deletedAt,
		}));
	}

	private assertCanNotify(actor: Actor, notify: boolean | undefined): void {
		if (notify !== false) {
			requirePermission(actor, "notifications.send");
		}
	}

	private async load(id: string): Promise<Incident> {
		const incident = await this.find(id, { consistent: true });
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

	/** Checks each region id. `null` and `undefined` pass through. */
	private async validateRegions(
		serviceIds: readonly string[],
		regions: ServiceRegions[] | null | undefined,
	): Promise<ServiceRegions[] | null | undefined> {
		if (regions == null) {
			return regions;
		}
		assertRegionServices(serviceIds, regions);
		const cleaned: ServiceRegions[] = [];
		for (const entry of regions) {
			for (const regionId of entry.regionIds) {
				await this.regions.get(regionId);
			}
			cleaned.push({
				serviceId: entry.serviceId,
				regionIds: entry.regionIds,
			});
		}
		return cleaned;
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

	/** The status a new service gets when the update sets no status. */
	private addedStatus(incident: Incident): ServiceStatus | undefined {
		if (isClosedStatus(incident.status)) {
			return undefined;
		}
		if (incident.kind === "maintenance") {
			return incident.status === "verifying" ? "under_maintenance" : undefined;
		}
		return incident.impact === "none"
			? undefined
			: impactToStatus(incident.impact);
	}

	/**
	 * Moves the affected services to their new status. A service with its own
	 * status gets that status. The plan sets the status of the other services.
	 * A service that this update added gets a status when the plan sets none.
	 */
	private async syncServices(
		incident: Incident,
		plan: ServicePlan | undefined,
		overrides: readonly ServiceStatusOverride[] = [],
		added: ReadonlySet<string> = new Set(),
	): Promise<void> {
		const own = new Map(
			overrides.map((override) => [override.serviceId, override.status]),
		);
		const catchUp = this.addedStatus(incident);
		const addedCatchUp = catchUp !== undefined && added.size > 0;
		if (
			(!plan && own.size === 0 && !addedCatchUp) ||
			incident.serviceIds.length === 0
		) {
			return;
		}
		const others = plan?.restore
			? (await this.list({ open: true })).filter(
					// scheduled maintenance has not touched any service yet
					(other) => other.id !== incident.id && other.status !== "scheduled",
				)
			: [];
		for (const serviceId of incident.serviceIds) {
			const status =
				own.get(serviceId) ??
				plan?.status ??
				(added.has(serviceId) ? catchUp : undefined);
			if (!status) {
				continue;
			}
			const service = await this.ctx.store.get("services", serviceId, {
				consistent: true,
			});
			if (!service) {
				continue;
			}
			if (
				!own.has(serviceId) &&
				others.some((other) => other.serviceIds.includes(serviceId))
			) {
				continue;
			}
			await this.catalog.applyStatus(service, status, incident.id);
		}
	}

	private async notify(
		actor: Actor,
		event: NotificationEvent,
		incident: Incident,
		update: IncidentUpdate,
		enabled: boolean | undefined,
		options: PublishOptions,
	): Promise<void> {
		if (enabled === false) {
			return;
		}
		try {
			const subscribers = await this.subscribers.recipients(
				incident.serviceIds,
			);
			if (subscribers.length === 0) {
				return;
			}
			await this.jobs.start({
				actor,
				notification: {
					event,
					incident,
					update,
					settings: await this.settings.get(),
					services: await this.affectedServices(incident),
				},
				subscribers,
				channels: await this.notificationSettings.resolve(),
				jobId: options.jobId,
				delivery: options.delivery,
			});
		} catch (error) {
			console.error(
				`[notifications] failed to notify for ${incident.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
