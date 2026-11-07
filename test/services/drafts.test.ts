import type { Actor } from "@/lib/domain/types";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@/lib/errors";
import {
	ADMIN,
	createTestContext,
	EDITOR,
	type TestContext,
	VIEWER,
} from "../helpers";

const AGENT: Actor = {
	type: "agent",
	id: "agt_bot",
	name: "Ops bot",
	role: "editor",
};

describe("DraftService", () => {
	let t: TestContext;
	let api: string;

	beforeEach(async () => {
		t = createTestContext();
		api = (await t.services.catalog.create(ADMIN, { name: "API" })).id;
		await t.services.subscribers.addWebhook(ADMIN, {
			url: "https://hooks.example.com/x",
		});
	});

	const statusOf = async (id: string) =>
		(await t.services.catalog.get(id)).status;

	it("holds a new incident until a person approves it", async () => {
		const draft = await t.services.drafts.create(AGENT, {
			title: "  API errors  ",
			message: "We are looking into errors.",
			impact: "critical",
			serviceIds: [api, api],
		});
		expect(draft).toMatchObject({
			action: "create",
			kind: "incident",
			state: "pending",
			content: {
				title: "API errors",
				impact: "critical",
				serviceIds: [api],
				message: "We are looking into errors.",
			},
			createdBy: { type: "agent", id: AGENT.id, name: AGENT.name },
		});
		expect(draft.id).toMatch(/^drf_/);
		expect(draft.incidentId).toBeUndefined();
		expect(await t.services.incidents.list()).toHaveLength(0);
		expect(await statusOf(api)).toBe("operational");
		expect(t.notifier.incidents).toHaveLength(0);

		t.clock.advance(60_000);
		const { draft: approved, incident } = await t.services.drafts.approve(
			EDITOR,
			draft.id,
			{
				title: "Elevated API errors",
				message: "We are looking into elevated errors.",
				impact: "major",
				serviceIds: [api],
			},
		);
		expect(incident).toMatchObject({
			kind: "incident",
			title: "Elevated API errors",
			impact: "major",
			status: "investigating",
			createdBy: { type: "member", id: EDITOR.id },
		});
		expect(incident.updates[0]?.message).toBe(
			"We are looking into elevated errors.",
		);
		expect(await statusOf(api)).toBe("partial_outage");
		expect(t.notifier.incidents.map((n) => n.notification.event)).toEqual([
			"incident.created",
		]);
		expect(approved).toMatchObject({
			state: "approved",
			incidentId: incident.id,
			content: { title: "Elevated API errors", impact: "major" },
			reviewedBy: { type: "member", id: EDITOR.id, name: EDITOR.name },
			reviewedAt: "2026-11-02T12:01:00.000Z",
		});
		await expect(t.services.drafts.get(draft.id)).resolves.toEqual(approved);
	});

	it("drafts an update that keeps the current status when it has none", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "API errors",
			message: "Investigating",
			serviceIds: [api],
			notify: false,
		});
		const draft = await t.services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "A fix is ready.",
		});
		expect(draft).toMatchObject({
			action: "update",
			kind: "incident",
			incidentId: incident.id,
			content: { message: "A fix is ready." },
		});
		expect(draft.content.status).toBeUndefined();
		await t.services.incidents.postUpdate(EDITOR, incident.id, {
			status: "identified",
			message: "Bad deploy",
			notify: false,
		});

		const { draft: approved, incident: updated } =
			await t.services.drafts.approve(EDITOR, draft.id, {
				message: "A fix is ready to deploy.",
			});
		expect(updated.status).toBe("identified");
		expect(updated.updates.at(-1)).toMatchObject({
			status: "identified",
			message: "A fix is ready to deploy.",
			author: { id: EDITOR.id },
		});
		expect(approved.incidentId).toBe(incident.id);
		expect(t.notifier.incidents.map((n) => n.notification.event)).toEqual([
			"incident.updated",
		]);

		const closing = await t.services.drafts.create(AGENT, {
			incidentId: incident.id,
			message: "Resolved",
			status: "resolved",
		});
		await t.services.drafts.approve(EDITOR, closing.id, closing.content);
		expect(await statusOf(api)).toBe("operational");
		expect(t.notifier.incidents.at(-1)?.notification.event).toBe(
			"incident.resolved",
		);
	});

	it("keeps the window of maintenance only", async () => {
		const window = {
			scheduledStart: "2026-11-03T02:00:00+01:00",
			scheduledEnd: "2026-11-03T04:00:00Z",
		};
		await expect(
			t.services.drafts.create(AGENT, {
				kind: "maintenance",
				title: "Upgrade",
				message: "Planned",
			}),
		).rejects.toThrow("Maintenance requires scheduledStart and scheduledEnd");
		const maintenance = await t.services.drafts.create(AGENT, {
			kind: "maintenance",
			title: "Upgrade",
			message: "Planned",
			...window,
		});
		expect(maintenance).toMatchObject({
			kind: "maintenance",
			content: {
				scheduledStart: "2026-11-03T01:00:00.000Z",
				scheduledEnd: "2026-11-03T04:00:00.000Z",
			},
		});
		const incident = await t.services.drafts.create(AGENT, {
			title: "Errors",
			message: "Investigating",
			...window,
		});
		expect(incident.content.scheduledStart).toBeUndefined();
		expect(incident.content.scheduledEnd).toBeUndefined();

		const { incident: scheduled } = await t.services.drafts.approve(
			EDITOR,
			maintenance.id,
			maintenance.content,
		);
		expect(scheduled).toMatchObject({
			kind: "maintenance",
			status: "scheduled",
			scheduledStart: "2026-11-03T01:00:00.000Z",
		});
		expect(t.notifier.incidents.at(-1)?.notification.event).toBe(
			"maintenance.scheduled",
		);
	});

	it("checks drafts with the rules of publication", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "API errors",
			message: "Investigating",
			notify: false,
		});
		await expect(
			t.services.drafts.create(AGENT, { message: "No title" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.drafts.create(AGENT, {
				title: "Errors",
				message: "x",
				status: "scheduled",
			}),
		).rejects.toThrow('Status "scheduled" is not valid for incident');
		await expect(
			t.services.drafts.create(AGENT, {
				title: "Errors",
				message: "x",
				serviceIds: ["cmp_missing"],
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.drafts.create(AGENT, {
				incidentId: "inc_missing",
				message: "x",
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.drafts.create(AGENT, {
				incidentId: incident.id,
				message: "x",
				status: "in_progress",
			}),
		).rejects.toThrow('Status "in_progress" is not valid for incident');
		await expect(
			t.services.drafts.create(AGENT, {
				incidentId: incident.id,
				message: " ",
			}),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.drafts.create(AGENT, {
				incidentId: incident.id,
				kind: "incident",
				title: "New title",
				serviceIds: [api],
				message: "x",
			}),
		).rejects.toThrow(
			"kind, title, serviceIds: only a new incident or maintenance uses these fields",
		);
		await expect(
			t.services.drafts.create(VIEWER, { title: "Errors", message: "x" }),
		).rejects.toBeInstanceOf(ForbiddenError);
		expect(await t.services.drafts.list()).toHaveLength(0);
	});

	it("saves edits while the draft waits for review", async () => {
		const draft = await t.services.drafts.create(AGENT, {
			title: "API errors",
			message: "Investigating",
			serviceStatus: "major_outage",
		});
		t.clock.advance(60_000);
		const saved = await t.services.drafts.update(EDITOR, draft.id, {
			title: "API errors",
			message: "We are looking into it.",
		});
		expect(saved).toMatchObject({
			state: "pending",
			content: { message: "We are looking into it." },
			updatedAt: "2026-11-02T12:01:00.000Z",
		});
		expect(saved.content.serviceStatus).toBeUndefined();
		await expect(
			t.services.drafts.update(EDITOR, draft.id, { title: "", message: "x" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.drafts.update(VIEWER, draft.id, saved.content),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			t.services.drafts.update(EDITOR, "drf_missing", saved.content),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(t.services.drafts.get(draft.id)).resolves.toEqual(saved);
		expect(t.notifier.incidents).toHaveLength(0);
	});

	it("stops changes after a draft is reviewed", async () => {
		const discarded = await t.services.drafts.create(AGENT, {
			title: "False alarm",
			message: "x",
		});
		const closed = await t.services.drafts.discard(EDITOR, discarded.id);
		expect(closed).toMatchObject({
			state: "discarded",
			reviewedBy: { id: EDITOR.id },
			reviewedAt: "2026-11-02T12:00:00.000Z",
		});
		await expect(
			t.services.drafts.discard(VIEWER, discarded.id),
		).rejects.toBeInstanceOf(ForbiddenError);
		for (const change of [
			() => t.services.drafts.update(EDITOR, discarded.id, closed.content),
			() => t.services.drafts.approve(EDITOR, discarded.id, closed.content),
			() => t.services.drafts.discard(EDITOR, discarded.id),
		]) {
			await expect(change()).rejects.toThrow(
				"This draft was already discarded",
			);
		}

		const approved = await t.services.drafts.create(AGENT, {
			title: "Errors",
			message: "x",
		});
		await t.services.drafts.approve(EDITOR, approved.id, approved.content);
		await expect(
			t.services.drafts.approve(EDITOR, approved.id, approved.content),
		).rejects.toThrow("This draft was already approved");
		await expect(
			t.services.drafts.approve(VIEWER, approved.id, approved.content),
		).rejects.toBeInstanceOf(ForbiddenError);
		expect(await t.services.incidents.list()).toHaveLength(1);
		expect(t.notifier.incidents).toHaveLength(1);
	});

	it("lets only one of two reviews at the same time succeed", async () => {
		const draft = await t.services.drafts.create(AGENT, {
			title: "Errors",
			message: "x",
		});
		const results = await Promise.allSettled([
			t.services.drafts.approve(EDITOR, draft.id, draft.content),
			t.services.drafts.discard(ADMIN, draft.id),
		]);
		const rejected = results.filter((result) => result.status === "rejected");
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
			ConflictError,
		);
		const stored = await t.services.drafts.get(draft.id);
		const published = await t.services.incidents.list();
		expect(published).toHaveLength(stored.state === "approved" ? 1 : 0);
		expect(t.notifier.incidents).toHaveLength(published.length);
	});

	it("returns the draft to review with the edits when publication fails", async () => {
		const draft = await t.services.drafts.create(AGENT, {
			title: "Errors",
			message: "x",
		});
		vi.spyOn(t.services.incidents, "create").mockRejectedValueOnce(
			new ConflictError("busy"),
		);
		await expect(
			t.services.drafts.approve(EDITOR, draft.id, {
				title: "Errors",
				message: "Edited",
			}),
		).rejects.toThrow("busy");
		const stored = await t.services.drafts.get(draft.id);
		expect(stored).toMatchObject({
			state: "pending",
			content: { message: "Edited" },
		});
		expect(stored.reviewedBy).toBeUndefined();
		const { draft: approved } = await t.services.drafts.approve(
			EDITOR,
			draft.id,
			stored.content,
		);
		expect(approved.state).toBe("approved");
	});

	it("lists drafts by review state, newest first", async () => {
		const first = await t.services.drafts.create(AGENT, {
			title: "First",
			message: "x",
		});
		t.clock.advance(1000);
		const second = await t.services.drafts.create(AGENT, {
			title: "Second",
			message: "x",
		});
		t.clock.advance(1000);
		const third = await t.services.drafts.create(AGENT, {
			title: "Third",
			message: "x",
		});
		await t.services.drafts.discard(EDITOR, second.id);
		const ids = (drafts: { id: string }[]) => drafts.map((draft) => draft.id);
		expect(ids(await t.services.drafts.list({ pending: true }))).toEqual([
			third.id,
			first.id,
		]);
		expect(ids(await t.services.drafts.list({ pending: false }))).toEqual([
			second.id,
		]);
		expect(ids(await t.services.drafts.list({ limit: 2 }))).toEqual([
			third.id,
			second.id,
		]);
		await expect(t.services.drafts.find("drf_missing")).resolves.toBe(
			undefined,
		);
		await expect(t.services.drafts.get("drf_missing")).rejects.toBeInstanceOf(
			NotFoundError,
		);
	});
});
