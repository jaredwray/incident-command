import { createId } from "../crypto";
import type {
	DraftContentInput,
	NotificationDraftInput,
} from "../domain/schemas";
import type {
	Actor,
	DraftContent,
	Incident,
	IncidentKind,
	NotificationDraft,
} from "../domain/types";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { Condition } from "../store/types";
import { authorRef, iso, requireRole, type ServiceContext } from "./context";
import type { IncidentService } from "./incidents";

/** The portal path where a person reviews a notification draft. */
export function draftPath(id: string): string {
	return `/manage/drafts/${encodeURIComponent(id)}`;
}

export interface DraftListOptions {
	/** `true` for drafts that wait for review, `false` for reviewed drafts. */
	pending?: boolean;
	limit?: number;
}

/** What a draft publishes: a new event of a kind, or an update to an incident. */
type Target =
	| { action: "create"; kind: IncidentKind }
	| { action: "update"; incidentId: string };

/** Fields that only a new incident or maintenance uses. */
const CREATE_ONLY_FIELDS = [
	"kind",
	"title",
	"impact",
	"serviceIds",
	"scheduledStart",
	"scheduledEnd",
] as const;

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

	constructor(ctx: ServiceContext, incidents: IncidentService) {
		this.ctx = ctx;
		this.incidents = incidents;
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
		requireRole(actor, "editor");
		const { incidentId, ...fields } = input;
		const target: Target = incidentId
			? { action: "update", incidentId }
			: { action: "create", kind: fields.kind ?? "incident" };
		const { kind, content } = await this.prepare(target, fields);
		const now = iso(this.ctx.now());
		return this.ctx.store.insert("notification_drafts", {
			id: createId("drf"),
			action: target.action,
			kind,
			incidentId,
			content,
			state: "pending",
			createdBy: authorRef(actor),
			createdAt: now,
			updatedAt: now,
		});
	}

	/** Replaces the content of a draft that waits for review. */
	async update(
		actor: Actor,
		id: string,
		input: DraftContentInput,
	): Promise<NotificationDraft> {
		requireRole(actor, "editor");
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
	): Promise<{ draft: NotificationDraft; incident: Incident }> {
		requireRole(actor, "editor");
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
		let incident: Incident;
		try {
			incident = await this.publish(actor, reviewed);
		} catch (error) {
			// Nothing was published. The draft waits for review again, with the edits.
			await this.ctx.store.update("notification_drafts", {
				...current,
				content,
				updatedAt: now,
			});
			throw error;
		}
		const draft: NotificationDraft = { ...reviewed, incidentId: incident.id };
		await this.ctx.store.update("notification_drafts", draft);
		return { draft, incident };
	}

	/** Closes a draft without publishing or sending it. */
	async discard(actor: Actor, id: string): Promise<NotificationDraft> {
		requireRole(actor, "editor");
		const current = await this.pending(id);
		const now = iso(this.ctx.now());
		return this.save({
			...current,
			state: "discarded",
			reviewedBy: authorRef(actor),
			reviewedAt: now,
			updatedAt: now,
		});
	}

	/**
	 * Checks the content with the same rules that publication uses, so an
	 * approved draft does not fail later.
	 */
	private async prepare(
		target: Target,
		input: DraftContentInput & { kind?: IncidentKind },
	): Promise<{ kind: IncidentKind; content: DraftContent }> {
		if (target.action === "update") {
			const extra = CREATE_ONLY_FIELDS.filter((field) =>
				field === "serviceIds"
					? (input.serviceIds?.length ?? 0) > 0
					: input[field] !== undefined,
			);
			if (extra.length > 0) {
				throw new ValidationError(
					`${extra.join(", ")}: only a new incident or maintenance uses these fields. Remove them or remove incidentId.`,
				);
			}
			const { incident, data } = await this.incidents.checkUpdate(
				target.incidentId,
				{
					status: input.status,
					message: input.message,
					serviceStatus: input.serviceStatus,
				},
			);
			return {
				kind: incident.kind,
				content: {
					status: data.status,
					message: data.message,
					serviceStatus: data.serviceStatus,
				},
			};
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
		};
		if (target.kind === "maintenance") {
			content.scheduledStart = data.scheduledStart;
			content.scheduledEnd = data.scheduledEnd;
		}
		return { kind: target.kind, content };
	}

	private async publish(
		actor: Actor,
		draft: NotificationDraft,
	): Promise<Incident> {
		const { content } = draft;
		if (draft.action === "update") {
			return this.incidents.postUpdate(actor, draft.incidentId as string, {
				status: content.status,
				message: content.message,
				serviceStatus: content.serviceStatus,
			});
		}
		return this.incidents.create(actor, {
			...content,
			kind: draft.kind,
			title: content.title as string,
		});
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
