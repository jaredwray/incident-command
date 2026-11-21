import { createId, sha256 } from "../crypto";
import type {
	DraftContentInput,
	NotificationDraftInput,
} from "../domain/schemas";
import type {
	Actor,
	DraftAction,
	DraftContent,
	Incident,
	IncidentKind,
	IncidentUpdate,
	NotificationDraft,
	ServiceRegions,
} from "../domain/types";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Condition } from "../store/types";
import type { ActivityService } from "./activity";
import {
	authorRef,
	iso,
	requirePermission,
	type ServiceContext,
} from "./context";
import {
	type IncidentService,
	newIncidentId,
	type PublishOptions,
} from "./incidents";

/** The portal path where a person reviews a notification draft. */
export function draftPath(id: string): string {
	return `/manage/drafts/${encodeURIComponent(id)}`;
}

/**
 * Regions stored on a draft.
 * An old draft can still have `regionId`. That region applies to each service.
 */
export function regionsInDraft(
	content: DraftContent & { regionId?: string },
): ServiceRegions[] | undefined {
	if (content.serviceRegions && content.serviceRegions.length > 0) {
		return content.serviceRegions;
	}
	if (
		!content.regionId ||
		!content.serviceIds ||
		content.serviceIds.length === 0
	) {
		return undefined;
	}
	return content.serviceIds.map((serviceId) => ({
		serviceId,
		regionIds: [content.regionId as string],
	}));
}

export interface DraftListOptions {
	/** `true` for drafts that wait for review, `false` for reviewed drafts. */
	pending?: boolean;
	/** Only the drafts for this incident. */
	incidentId?: string;
	limit?: number;
}

/** The id of the post that a draft published. */
function publishedUpdateId(
	action: DraftAction,
	incident: Incident,
	recordId: string,
): string {
	if (action === "update") {
		return recordId;
	}
	return (incident.updates[0] as IncidentUpdate).id;
}

/** What a draft publishes: a new event of a kind, or an update to an incident. */
type Target =
	| { action: "create"; kind: IncidentKind }
	| { action: "update"; incidentId: string };

/** Fields that only a new incident or maintenance uses. */
const CREATE_ONLY_FIELDS = ["kind", "scheduledStart", "scheduledEnd"] as const;

function targetOf(draft: NotificationDraft): Target {
	return draft.action === "update"
		? { action: "update", incidentId: draft.incidentId as string }
		: { action: "create", kind: draft.kind };
}

/**
 * Notification drafts let an agent write a notification that a person
 * reviews. Nothing is published or sent until a person approves the draft.
 */
export class DraftService {
	private readonly ctx: ServiceContext;
	private readonly incidents: IncidentService;
	private readonly activity: ActivityService;

	constructor(
		ctx: ServiceContext,
		incidents: IncidentService,
		activity: ActivityService,
	) {
		this.ctx = ctx;
		this.incidents = incidents;
		this.activity = activity;
	}

	async list(options: DraftListOptions = {}): Promise<NotificationDraft[]> {
		const where: Condition[] = [];
		if (options.pending !== undefined) {
			where.push({
				field: "state",
				op: options.pending ? "eq" : "ne",
				value: "pending",
			});
		}
		if (options.incidentId !== undefined) {
			where.push({
				field: "incidentId",
				op: "eq",
				value: options.incidentId,
			});
		}
		return this.ctx.store.find("notification_drafts", {
			where,
			sort: [{ field: "createdAt", direction: "desc" }],
			limit: options.limit,
		});
	}

	async find(id: string): Promise<NotificationDraft | undefined> {
		return this.ctx.store.get("notification_drafts", id);
	}

	async get(id: string): Promise<NotificationDraft> {
		const draft = await this.find(id);
		if (!draft) {
			throw new NotFoundError("Notification draft", id);
		}
		return draft;
	}

	/** Saves a draft for review. With `incidentId`, the draft is an update to that incident. */
	async create(
		actor: Actor,
		input: NotificationDraftInput,
	): Promise<NotificationDraft> {
		requirePermission(actor, "drafts.write");
		const { requestId, incidentId, ...fields } = input;
		const id = requestId
			? `drf_${sha256(JSON.stringify([actor.type, actor.id, requestId]))}`
			: createId("drf");
		if (requestId) {
			const existing = await this.ctx.store.get("notification_drafts", id, {
				consistent: true,
			});
			if (existing) return existing;
		}
		const target: Target = incidentId
			? { action: "update", incidentId }
			: { action: "create", kind: fields.kind ?? "incident" };
		const { kind, content } = await this.prepare(target, fields);
		const now = iso(this.ctx.now());
		const draft: NotificationDraft = {
			id,
			action: target.action,
			kind,
			incidentId,
			content,
			state: "pending",
			createdBy: authorRef(actor),
			createdAt: now,
			updatedAt: now,
		};
		try {
			return await this.ctx.store.insert("notification_drafts", draft);
		} catch (error) {
			if (!requestId || !(error instanceof ConflictError)) throw error;
			const existing = await this.ctx.store.get("notification_drafts", id, {
				consistent: true,
			});
			if (!existing) throw error;
			return existing;
		}
	}

	/** Replaces the content of a draft that waits for review. */
	async update(
		actor: Actor,
		id: string,
		input: DraftContentInput,
	): Promise<NotificationDraft> {
		requirePermission(actor, "drafts.review");
		const current = await this.pending(id);
		const { content } = await this.prepare(targetOf(current), input);
		return this.save({ ...current, content, updatedAt: iso(this.ctx.now()) });
	}

	/**
	 * Saves the reviewed content, then publishes the draft on the status page
	 * and notifies subscribers. Only one review of a draft can succeed.
	 */
	async approve(
		actor: Actor,
		id: string,
		input: DraftContentInput,
		options: PublishOptions = {},
	): Promise<{ draft: NotificationDraft; incident: Incident }> {
		requirePermission(actor, "drafts.review");
		const current = await this.pending(id);
		const { content } = await this.prepare(targetOf(current), input);
		const now = iso(this.ctx.now());
		const reviewed = await this.save({
			...current,
			content,
			state: "approved",
			reviewedBy: authorRef(actor),
			reviewedAt: now,
			updatedAt: now,
		});
		// The id is set before publication, so a failure can tell if the record was saved.
		const recordId =
			reviewed.action === "update"
				? createId("upd")
				: newIncidentId(reviewed.kind);
		let incident: Incident;
		try {
			incident = await this.publish(actor, reviewed, recordId, options);
		} catch (error) {
			// When the record was saved, a later step failed. The draft stays
			// approved, so a second approval cannot publish it again. When
			// nothing was saved, the draft waits for review again, with the edits.
			const saved = await this.publishedIncident(reviewed, recordId);
			await this.ctx.store.update(
				"notification_drafts",
				saved
					? {
							...reviewed,
							incidentId: reviewed.incidentId ?? recordId,
							updateId: publishedUpdateId(reviewed.action, saved, recordId),
							publishedAt: iso(this.ctx.now()),
						}
					: { ...current, content, updatedAt: now },
			);
			throw error;
		}
		const draft: NotificationDraft = {
			...reviewed,
			incidentId: incident.id,
			updateId: publishedUpdateId(reviewed.action, incident, recordId),
			publishedAt: iso(this.ctx.now()),
		};
		await this.ctx.store.update("notification_drafts", draft);
		await this.recordReview(actor, current, "draft_approved");
		return { draft, incident };
	}

	/** Closes a draft without publishing or sending it. */
	async discard(actor: Actor, id: string): Promise<NotificationDraft> {
		requirePermission(actor, "drafts.review");
		const current = await this.pending(id);
		const now = iso(this.ctx.now());
		const saved = await this.save({
			...current,
			state: "discarded",
			reviewedBy: authorRef(actor),
			reviewedAt: now,
			updatedAt: now,
		});
		await this.recordReview(actor, current, "draft_discarded");
		return saved;
	}

	/** Returns the migrated agent id for a draft from an old OAuth grant. */
	private async reviewAgentId(createdById: string): Promise<string> {
		if (!createdById.startsWith("ogr_")) {
			return createdById;
		}
		const id = `agt_${createdById.slice(4)}`;
		const agent = await this.ctx.store.get("agents", id);
		return agent ? agent.id : createdById;
	}

	private async recordReview(
		actor: Actor,
		draft: NotificationDraft,
		type: "draft_approved" | "draft_discarded",
	): Promise<void> {
		if (draft.createdBy.type !== "agent") {
			return;
		}
		await this.activity.record({
			agentId: await this.reviewAgentId(draft.createdBy.id),
			type,
			actor: authorRef(actor),
			target: { type: "draft", id: draft.id },
			outcome: "ok",
		});
	}

	private async prepare(
		target: Target,
		input: DraftContentInput & { kind?: IncidentKind },
	): Promise<{ kind: IncidentKind; content: DraftContent }> {
		if (target.action === "update") {
			const extra = CREATE_ONLY_FIELDS.filter(
				(field) => input[field] !== undefined,
			);
			if (extra.length > 0) {
				throw new ValidationError(
					`${extra.join(", ")}: only a new incident or maintenance uses these fields. Remove them or remove incidentId.`,
				);
			}
			const { incident, data } = await this.incidents.checkUpdate(
				target.incidentId,
				{
					title: input.title,
					impact: input.impact,
					status: input.status,
					message: input.message,
					serviceStatus: input.serviceStatus,
					serviceStatuses: input.serviceStatuses,
					serviceIds: input.serviceIds,
					serviceRegions: input.serviceRegions,
				},
			);
			const content: DraftContent = {
				status: data.status,
				message: data.message,
				serviceStatus: data.serviceStatus,
				serviceStatuses: data.serviceStatuses,
				serviceIds: data.serviceIds,
			};
			if (data.serviceRegions && data.serviceRegions.length > 0) {
				content.serviceRegions = data.serviceRegions;
			}
			if (data.title !== undefined && data.title !== incident.title) {
				content.title = data.title;
			}
			if (data.impact !== undefined && data.impact !== incident.impact) {
				content.impact = data.impact;
			}
			return { kind: incident.kind, content };
		}
		const data = await this.incidents.check({
			...input,
			kind: target.kind,
			title: input.title as string,
		});
		const content: DraftContent = {
			title: data.title,
			impact: data.impact,
			serviceIds: data.serviceIds,
			status: data.status,
			message: data.message,
			serviceStatus: data.serviceStatus,
			serviceStatuses: data.serviceStatuses,
		};
		if (data.serviceRegions && data.serviceRegions.length > 0) {
			content.serviceRegions = data.serviceRegions;
		}
		if (target.kind === "maintenance") {
			content.scheduledStart = data.scheduledStart;
			content.scheduledEnd = data.scheduledEnd;
		}
		return { kind: target.kind, content };
	}

	private async publish(
		actor: Actor,
		draft: NotificationDraft,
		id: string,
		options: PublishOptions,
	): Promise<Incident> {
		const { content } = draft;
		const publishOptions: PublishOptions = { ...options, id };
		const serviceRegions = regionsInDraft(content);
		if (draft.action === "update") {
			return this.incidents.postUpdate(
				actor,
				draft.incidentId as string,
				{
					title: content.title,
					impact: content.impact,
					status: content.status,
					message: content.message,
					serviceStatus: content.serviceStatus,
					serviceStatuses: content.serviceStatuses,
					serviceIds: content.serviceIds,
					serviceRegions,
				},
				publishOptions,
			);
		}
		const { regionId: _legacy, ...rest } = content as DraftContent & {
			regionId?: string;
		};
		return this.incidents.create(
			actor,
			{
				...rest,
				kind: draft.kind,
				title: content.title as string,
				serviceRegions,
			},
			publishOptions,
		);
	}

	/** The incident when publication saved the record with this id. */
	private async publishedIncident(
		draft: NotificationDraft,
		id: string,
	): Promise<Incident | undefined> {
		const incident = await this.incidents.find(
			draft.action === "update" ? (draft.incidentId as string) : id,
			{ consistent: true },
		);
		const saved =
			draft.action === "update"
				? Boolean(incident?.updates.some((update) => update.id === id))
				: incident !== undefined;
		return saved ? incident : undefined;
	}

	/** The draft, read from the store, when it still waits for review. */
	private async pending(id: string): Promise<NotificationDraft> {
		const draft = await this.ctx.store.get("notification_drafts", id, {
			consistent: true,
		});
		if (!draft) {
			throw new NotFoundError("Notification draft", id);
		}
		if (draft.state !== "pending") {
			throw new ConflictError(`This draft was already ${draft.state}`);
		}
		return draft;
	}

	/** Writes a draft only while it waits for review, so only one review succeeds. */
	private async save(next: NotificationDraft): Promise<NotificationDraft> {
		const saved = await this.ctx.store.update("notification_drafts", next, {
			where: [{ field: "state", op: "eq", value: "pending" }],
		});
		if (!saved) {
			throw new ConflictError(
				"Somebody else reviewed this draft at the same time. Reload the draft.",
			);
		}
		return saved;
	}
}
