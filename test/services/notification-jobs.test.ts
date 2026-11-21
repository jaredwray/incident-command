import type { NotificationDelivery, NotificationJob } from "@/lib/domain/types";
import { NotFoundError, PermissionDeniedError } from "@/lib/errors";
import { NotificationQueue } from "@/lib/notifications/queue";
import { authorRef } from "@/lib/services/context";
import {
	ADMIN,
	createTestContext,
	EDITOR,
	type TestContext,
	VIEWER,
} from "../helpers";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function webhook(t: TestContext, url = "https://hooks.example.com/a") {
	return t.services.subscribers.addWebhook(ADMIN, { url });
}

async function incident(t: TestContext, title = "API errors") {
	return t.services.incidents.create(ADMIN, {
		title,
		message: "Looking",
		notify: false,
	});
}

function jobDocument(
	t: TestContext,
	fields: Partial<NotificationJob> &
		Pick<NotificationJob, "id" | "incidentId" | "updateId">,
): NotificationJob {
	const now = t.clock.now().toISOString();
	return {
		event: "incident.updated",
		queued: true,
		provider: "redis",
		state: "active",
		total: 1,
		sent: 0,
		failed: 0,
		createdBy: authorRef(ADMIN),
		createdAt: now,
		heartbeatAt: now,
		...fields,
	};
}

async function delivery(
	t: TestContext,
	fields: Pick<
		NotificationDelivery,
		"id" | "jobId" | "subscriberId" | "state"
	> &
		Partial<NotificationDelivery>,
) {
	const now = t.clock.now().toISOString();
	await t.store.insert("notification_deliveries", {
		channel: "webhook",
		label: "hooks.example.com",
		order: 0,
		createdAt: now,
		updatedAt: now,
		...fields,
	});
}

describe("NotificationJobService", () => {
	let t: TestContext;

	beforeEach(() => {
		t = createTestContext();
	});

	it("records a sent row and a failed row for a direct send", async () => {
		await webhook(t, "https://hooks.example.com/ok");
		await webhook(t, "https://hooks.example.com/bad");
		t.notifier.failTargets.add("https://hooks.example.com/bad");
		const created = await t.services.incidents.create(ADMIN, {
			title: "API errors",
			message: "Looking",
			notify: true,
		});
		const jobs = await t.store.find("notification_jobs", {});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			queued: false,
			state: "done",
			sent: 1,
			failed: 1,
			incidentId: created.id,
		});
		const view = await t.services.notificationJobs.detail(
			ADMIN,
			jobs[0]?.id ?? "",
		);
		expect(view.deliveries.map((row) => row.state).sort()).toEqual([
			"failed",
			"sent",
		]);
		expect(view.deliveries.find((row) => row.state === "failed")?.error).toBe(
			"provider",
		);
		expect(
			view.deliveries.every((row) => row.label === "hooks.example.com"),
		).toBe(true);
		const editor = await t.services.notificationJobs.detail(
			EDITOR,
			jobs[0]?.id ?? "",
		);
		expect(editor.deliveries.every((row) => row.label === undefined)).toBe(
			true,
		);
		await expect(
			t.services.notificationJobs.detail(VIEWER, jobs[0]?.id ?? ""),
		).rejects.toBeInstanceOf(PermissionDeniedError);
		await expect(
			t.services.notificationJobs.incidentProgress(VIEWER, created.id),
		).rejects.toBeInstanceOf(PermissionDeniedError);
		await expect(
			t.services.notificationJobs.incidentProgress(EDITOR, created.id),
		).resolves.toBeUndefined();
	});

	it("returns a background job before the send ends", async () => {
		await webhook(t);
		const created = await incident(t);
		const release = t.notifier.hold();
		const updated = await t.services.incidents.postUpdate(
			ADMIN,
			created.id,
			{ message: "Still looking", notify: true },
			{ delivery: "background", jobId: "njb_bg" },
		);
		expect(updated.updates.at(-1)?.message).toBe("Still looking");
		expect(t.notifier.incidents).toHaveLength(0);
		const open = await t.services.notificationJobs.lookup(ADMIN, "njb_bg");
		expect(open?.state).toBe("active");
		release();
		await vi.waitFor(async () => {
			expect(
				(await t.services.notificationJobs.lookup(ADMIN, "njb_bg"))?.state,
			).toBe("done");
		});
		expect(t.notifier.incidents).toHaveLength(1);
		await expect(
			t.services.notificationJobs.lookup(EDITOR, "njb_missing"),
		).resolves.toBeUndefined();
		await expect(
			t.services.notificationJobs.lookup(VIEWER, "njb_bg"),
		).rejects.toBeInstanceOf(PermissionDeniedError);
	});

	it("returns before the queue sends the notifications", async () => {
		vi.spyOn(NotificationQueue.prototype, "open").mockResolvedValue("ok");
		vi.spyOn(NotificationQueue.prototype, "enqueue").mockResolvedValue("ok");
		await t.services.notificationQueue.update(ADMIN, {
			revision: 0,
			provider: "redis",
		});
		await webhook(t);
		const created = await incident(t);
		await t.services.incidents.postUpdate(
			ADMIN,
			created.id,
			{ message: "Queued", notify: true },
			{ jobId: "njb_queued" },
		);
		expect(t.notifier.incidents).toHaveLength(0);
		expect(
			(await t.services.notificationJobs.lookup(ADMIN, "njb_queued"))?.queued,
		).toBe(true);
		await t.services.notificationJobs.process("njb_queued");
		const job = await t.services.notificationJobs.lookup(ADMIN, "njb_queued");
		expect(job).toMatchObject({ state: "done", sent: 1 });
	});

	it("sends each subscriber once when two runs overlap", async () => {
		await webhook(t, "https://hooks.example.com/a");
		await webhook(t, "https://hooks.example.com/b");
		const created = await incident(t);
		const release = t.notifier.hold();
		await t.services.incidents.postUpdate(
			ADMIN,
			created.id,
			{ message: "Overlap", notify: true },
			{ delivery: "background", jobId: "njb_once" },
		);
		await Promise.all([
			t.services.notificationJobs.run("njb_once"),
			t.services.notificationJobs.run("njb_once"),
		]);
		expect(t.notifier.incidents).toHaveLength(0);
		release();
		await vi.waitFor(() => expect(t.notifier.incidents).toHaveLength(1));
		expect(t.notifier.incidents[0]?.subscribers).toHaveLength(2);
		const done = await t.services.notificationJobs.lookup(ADMIN, "njb_once");
		expect(done).toMatchObject({ state: "done", sent: 2, failed: 0 });
	});

	it("sends the title from the queued update after a later post", async () => {
		const person = await webhook(t);
		const created = await incident(t, "Original");
		const first = await t.services.incidents.postUpdate(ADMIN, created.id, {
			title: "First title",
			message: "First",
			notify: false,
		});
		await t.services.incidents.postUpdate(ADMIN, created.id, {
			title: "Second title",
			message: "Second",
			notify: false,
		});
		const updateId = first.updates.at(-1)?.id ?? "";
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_old",
				incidentId: created.id,
				updateId,
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_old",
			jobId: "njb_old",
			subscriberId: person.id,
			state: "pending",
		});
		await t.services.notificationJobs.run("njb_old");
		const sent = t.notifier.incidents[0]?.notification;
		expect(sent?.incident.title).toBe("First title");
		expect(sent?.update.title).toBe("First title");
	});

	it("marks a stale queued job as interrupted and continues the pending rows", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Continue",
			notify: false,
		});
		const updateId = updated.updates.at(-1)?.id ?? "";
		const old = new Date(t.clock.now().getTime() - 16 * MINUTE).toISOString();
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_stale",
				incidentId: created.id,
				updateId,
				heartbeatAt: old,
				total: 2,
			}),
		);
		await delivery(t, {
			id: "ndl_sending",
			jobId: "njb_stale",
			subscriberId: person.id,
			state: "sending",
		});
		await delivery(t, {
			id: "ndl_pending",
			jobId: "njb_stale",
			subscriberId: person.id,
			state: "pending",
			order: 1,
		});
		const release = t.notifier.hold();
		const progress = await t.services.notificationJobs.incidentProgress(
			ADMIN,
			created.id,
		);
		expect(progress).toMatchObject({
			active: 1,
			sent: 0,
			failed: 1,
			fallback: true,
		});
		release();
		await vi.waitFor(async () => {
			expect(
				await t.services.notificationJobs.incidentProgress(ADMIN, created.id),
			).toMatchObject({ active: 0, sent: 1, failed: 1, fallback: true });
		});
		const view = await t.services.notificationJobs.detail(ADMIN, "njb_stale");
		expect(view.fallback).toBe("stalled");
		expect(view.deliveries.find((row) => row.id === "ndl_sending")?.error).toBe(
			"interrupted",
		);
		expect(view.deliveries.find((row) => row.id === "ndl_pending")?.state).toBe(
			"sent",
		);
		t.clock.advance(11 * MINUTE);
		await expect(
			t.services.notificationJobs.incidentProgress(ADMIN, created.id),
		).resolves.toBeUndefined();
	});

	it("waits before it recovers the same jobs again", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Wait",
			notify: false,
		});
		const updateId = updated.updates.at(-1)?.id ?? "";
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_fresh",
				incidentId: created.id,
				updateId,
				heartbeatAt: new Date(
					t.clock.now().getTime() - 16 * MINUTE,
				).toISOString(),
			}),
		);
		await delivery(t, {
			id: "ndl_fresh",
			jobId: "njb_fresh",
			subscriberId: person.id,
			state: "pending",
		});
		await t.services.notificationJobs.recover();
		await vi.waitFor(async () => {
			expect((await t.store.get("notification_jobs", "njb_fresh"))?.state).toBe(
				"done",
			);
		});
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_held",
				incidentId: created.id,
				updateId,
				heartbeatAt: new Date(
					t.clock.now().getTime() - 16 * MINUTE,
				).toISOString(),
			}),
		);
		await delivery(t, {
			id: "ndl_held",
			jobId: "njb_held",
			subscriberId: person.id,
			state: "pending",
		});
		await t.services.notificationJobs.recover();
		expect(
			(await t.store.get("notification_jobs", "njb_held"))?.fallback,
		).toBeUndefined();
		t.clock.advance(10_000);
		await t.services.notificationJobs.recover();
		expect((await t.store.get("notification_jobs", "njb_held"))?.fallback).toBe(
			"stalled",
		);
		await vi.waitFor(async () => {
			expect((await t.store.get("notification_jobs", "njb_held"))?.state).toBe(
				"done",
			);
		});
	});

	it("sends a fresh queued job after the stale time", async () => {
		vi.useFakeTimers();
		try {
			const person = await webhook(t);
			const created = await incident(t);
			const updateId = created.updates[0]?.id ?? "";
			await t.store.insert(
				"notification_jobs",
				jobDocument(t, {
					id: "njb_later",
					incidentId: created.id,
					updateId,
				}),
			);
			await delivery(t, {
				id: "ndl_later",
				jobId: "njb_later",
				subscriberId: person.id,
				state: "pending",
			});
			await t.services.notificationJobs.recover();
			expect((await t.store.get("notification_jobs", "njb_later"))?.state).toBe(
				"active",
			);
			t.clock.advance(15 * MINUTE);
			await vi.advanceTimersByTimeAsync(15 * MINUTE);
			expect((await t.store.get("notification_jobs", "njb_later"))?.state).toBe(
				"done",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps the resolution time of the queued post", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		const firstId = created.updates[0]?.id ?? "";
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_open",
				incidentId: created.id,
				updateId: firstId,
				event: "incident.created",
			}),
		);
		await delivery(t, {
			id: "ndl_open",
			jobId: "njb_open",
			subscriberId: person.id,
			state: "pending",
		});
		t.clock.advance(MINUTE);
		const resolved = await t.services.incidents.postUpdate(ADMIN, created.id, {
			status: "resolved",
			message: "Fixed",
			notify: false,
		});
		await t.services.notificationJobs.process("njb_open");
		const open = t.notifier.incidents[0]?.notification.incident;
		expect(open?.status).toBe("investigating");
		expect(open?.resolvedAt).toBeUndefined();

		const resolvedId = resolved.updates.at(-1)?.id ?? "";
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_closed",
				incidentId: created.id,
				updateId: resolvedId,
				event: "incident.resolved",
			}),
		);
		await delivery(t, {
			id: "ndl_closed",
			jobId: "njb_closed",
			subscriberId: person.id,
			state: "pending",
		});
		await t.services.incidents.postUpdate(ADMIN, created.id, {
			status: "investigating",
			message: "It is back",
			notify: false,
		});
		await t.services.notificationJobs.process("njb_closed");
		expect(t.notifier.incidents[1]?.notification.incident).toMatchObject({
			status: "resolved",
			resolvedAt: resolved.updates.at(-1)?.createdAt,
		});
	});

	it("does not finish a job when the counts do not match the total", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_split",
				incidentId: created.id,
				updateId: created.updates[0]?.id ?? "",
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_split",
			jobId: "njb_split",
			subscriberId: person.id,
			state: "pending",
		});
		const spy = vi.spyOn(t.store, "count").mockImplementation(async () => 0);
		await t.services.notificationJobs.process("njb_split");
		expect((await t.store.get("notification_jobs", "njb_split"))?.state).toBe(
			"active",
		);
		spy.mockRestore();
	});

	it("uses the longer limit for a durable provider", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Durable",
			notify: false,
		});
		const updateId = updated.updates.at(-1)?.id ?? "";
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_durable",
				incidentId: created.id,
				updateId,
				heartbeatAt: new Date(
					t.clock.now().getTime() - 10 * MINUTE,
				).toISOString(),
			}),
		);
		await delivery(t, {
			id: "ndl_durable",
			jobId: "njb_durable",
			subscriberId: person.id,
			state: "pending",
		});
		await t.services.notificationJobs.recover();
		expect(
			(await t.store.get("notification_jobs", "njb_durable"))?.fallback,
		).toBeUndefined();
		t.clock.advance(10_000);
		await t.store.update("notification_jobs", {
			...(await t.store.get("notification_jobs", "njb_durable")),
			heartbeatAt: new Date(
				t.clock.now().getTime() - 16 * MINUTE,
			).toISOString(),
		} as NotificationJob);
		await t.services.notificationJobs.recover();
		expect(
			(await t.store.get("notification_jobs", "njb_durable"))?.fallback,
		).toBe("stalled");
	});

	it("fails open rows when the incident or the update is gone", async () => {
		const person = await webhook(t);
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_gone",
				incidentId: "inc_missing",
				updateId: "upd_missing",
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_gone",
			jobId: "njb_gone",
			subscriberId: person.id,
			state: "pending",
		});
		await t.services.notificationJobs.process("njb_gone");
		expect(
			(await t.store.get("notification_deliveries", "ndl_gone"))?.error,
		).toBe("not_sent");
		const created = await incident(t);
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_upd",
				incidentId: created.id,
				updateId: "upd_missing",
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_upd",
			jobId: "njb_upd",
			subscriberId: "sub_missing",
			state: "sending",
		});
		await t.services.notificationJobs.process("njb_upd");
		expect(
			(await t.store.get("notification_deliveries", "ndl_upd"))?.error,
		).toBe("not_sent");
		await t.services.notificationJobs.process("njb_missing");
		await t.services.notificationJobs.process("njb_gone");
		await expect(
			t.services.notificationJobs.detail(ADMIN, "njb_missing"),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it("fails a row the notifier does not report and ignores an extra result", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Quiet",
			notify: false,
		});
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_quiet",
				incidentId: created.id,
				updateId: updated.updates.at(-1)?.id ?? "",
				queued: false,
				total: 1,
			}),
		);
		await delivery(t, {
			id: "ndl_quiet",
			jobId: "njb_quiet",
			subscriberId: person.id,
			state: "pending",
		});
		const original = t.notifier.notifyIncident.bind(t.notifier);
		t.notifier.notifyIncident = async (
			notification,
			subscribers,
			channels,
			onResult,
		) => {
			await onResult?.(
				{
					id: "sub_extra",
					type: "webhook",
					target: "https://extra.example.com",
					confirmed: true,
					token: "t",
					createdAt: t.clock.now().toISOString(),
				},
				true,
			);
			return original(notification, subscribers, channels, onResult);
		};
		await t.services.notificationJobs.process("njb_quiet");
		expect(
			(await t.store.get("notification_deliveries", "ndl_quiet"))?.state,
		).toBe("sent");

		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_skip",
				incidentId: created.id,
				updateId: updated.updates.at(-1)?.id ?? "",
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_skip",
			jobId: "njb_skip",
			subscriberId: person.id,
			state: "pending",
		});
		t.notifier.notifyIncident = async () => ({ sent: 0, failed: 0 });
		await t.services.notificationJobs.process("njb_skip");
		expect(
			(await t.store.get("notification_deliveries", "ndl_skip"))?.error,
		).toBe("not_sent");
	});

	it("keeps the job active when the store fails during a claim", async () => {
		await webhook(t);
		const created = await incident(t);
		const update = t.store.update.bind(t.store);
		let thrown = 0;
		vi.spyOn(t.store, "update").mockImplementation(async (...args) => {
			const doc = args[1] as { state?: string };
			if (args[0] === "notification_deliveries" && doc.state === "sending") {
				thrown += 1;
				throw thrown === 1 ? "store down" : new Error("store down");
			}
			return update(...args);
		});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		await t.services.incidents.postUpdate(
			ADMIN,
			created.id,
			{ message: "One", notify: true },
			{ delivery: "background", jobId: "njb_err1" },
		);
		await t.services.incidents.postUpdate(
			ADMIN,
			created.id,
			{ message: "Two", notify: true },
			{ delivery: "background", jobId: "njb_err2" },
		);
		await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
		expect(String(error.mock.calls[0]?.[0])).toContain("store down");
		expect(String(error.mock.calls[1]?.[0])).toContain("store down");
		expect((await t.store.get("notification_jobs", "njb_err1"))?.state).toBe(
			"active",
		);
		expect((await t.store.get("notification_jobs", "njb_err2"))?.state).toBe(
			"active",
		);
		error.mockRestore();
		vi.mocked(t.store.update).mockRestore();
	});

	it("finishes when the deadline extension throws", async () => {
		const people = [];
		for (let index = 0; index < 21; index += 1) {
			people.push(await webhook(t, `https://hooks.example.com/${index}`));
		}
		const created = await incident(t);
		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Batch",
			notify: false,
		});
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_batch",
				incidentId: created.id,
				updateId: updated.updates.at(-1)?.id ?? "",
				queued: false,
				total: people.length,
			}),
		);
		for (const [order, person] of people.entries()) {
			await delivery(t, {
				id: `ndl_batch_${order}`,
				jobId: "njb_batch",
				subscriberId: person.id,
				state: "pending",
				order,
			});
		}
		let calls = 0;
		await t.services.notificationJobs.process("njb_batch", async () => {
			calls += 1;
			if (calls === 1) {
				throw new Error("extend");
			}
		});
		expect(calls).toBe(2);
		expect((await t.store.get("notification_jobs", "njb_batch"))?.state).toBe(
			"done",
		);
		expect(t.notifier.incidents).toHaveLength(2);
	});

	it("deletes jobs that are older than 30 days and keeps a recent one until the hour passes", async () => {
		const old = new Date(t.clock.now().getTime() - 31 * DAY).toISOString();
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_old",
				incidentId: "inc_old",
				updateId: "upd_old",
				createdAt: old,
				state: "done",
			}),
		);
		await t.store.insert("notification_deliveries", {
			id: "ndl_old",
			jobId: "njb_old",
			subscriberId: "sub_old",
			channel: "email",
			label: "j***@example.com",
			order: 0,
			state: "sent",
			createdAt: old,
			updatedAt: old,
		});
		await webhook(t);
		const created = await incident(t);
		await t.services.incidents.postUpdate(
			ADMIN,
			created.id,
			{ message: "Prune", notify: true },
			{ jobId: "njb_new" },
		);
		expect(await t.store.get("notification_jobs", "njb_old")).toBeUndefined();
		expect(
			await t.store.get("notification_deliveries", "ndl_old"),
		).toBeUndefined();
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_kept",
				incidentId: "inc_kept",
				updateId: "upd_kept",
				createdAt: old,
				state: "done",
			}),
		);
		await t.services.notificationJobs.detail(ADMIN, "njb_new");
		expect(await t.store.get("notification_jobs", "njb_kept")).toBeDefined();
		t.clock.advance(60 * MINUTE);
		await t.services.notificationJobs.detail(ADMIN, "njb_new");
		expect(await t.store.get("notification_jobs", "njb_kept")).toBeUndefined();
	});

	it("shows the first 200 rows and keeps the stored counts after the job is done", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Many",
			notify: false,
		});
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_many",
				incidentId: created.id,
				updateId: updated.updates.at(-1)?.id ?? "",
				state: "done",
				total: 201,
				sent: 201,
				failed: 0,
				finishedAt: t.clock.now().toISOString(),
			}),
		);
		for (let order = 0; order < 201; order += 1) {
			await delivery(t, {
				id: `ndl_many_${order}`,
				jobId: "njb_many",
				subscriberId: person.id,
				state: "sent",
				order,
			});
		}
		const view = await t.services.notificationJobs.detail(ADMIN, "njb_many");
		expect(view.truncated).toBe(true);
		expect(view.deliveries).toHaveLength(200);
		expect(view.sent).toBe(201);
		await t.store.update("notification_deliveries", {
			...(await t.store.get("notification_deliveries", "ndl_many_0")),
			state: "failed",
			error: "provider",
		} as NotificationDelivery);
		const again = await t.services.notificationJobs.detail(ADMIN, "njb_many");
		expect(again.sent).toBe(201);
		expect(again.failed).toBe(0);
	});

	it("logs a send failure and skips a job that is already done", async () => {
		const person = await webhook(t);
		const created = await incident(t);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const insert = t.store.insert.bind(t.store);
		const insertSpy = vi
			.spyOn(t.store, "insert")
			.mockImplementation(async (collection, doc) => {
				if (collection === "notification_jobs") {
					throw "down";
				}
				return insert(collection, doc);
			});
		await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Boom",
			notify: true,
		});
		expect(String(error.mock.calls.at(-1)?.[0])).toContain("down");
		insertSpy.mockImplementation(async (collection, doc) => {
			if (collection === "notification_jobs") {
				throw new Error("down");
			}
			return insert(collection, doc);
		});
		await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Boom again",
			notify: true,
		});
		expect(String(error.mock.calls.at(-1)?.[0])).toContain("down");
		insertSpy.mockRestore();
		const original = t.notifier.notifyIncident.bind(t.notifier);
		t.notifier.notifyIncident = async (
			_notification,
			subscribers,
			_channels,
			onResult,
		) => {
			const subscriber = subscribers[0];
			if (subscriber) {
				await onResult?.(subscriber, true);
			}
			const job = (await t.store.find("notification_jobs", {}))[0];
			if (job) {
				await t.store.update("notification_jobs", {
					...job,
					state: "done",
					sent: 1,
					failed: 0,
					finishedAt: t.clock.now().toISOString(),
				});
			}
			return { sent: 1, failed: 0 };
		};
		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Done early",
			notify: false,
		});
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_early",
				incidentId: created.id,
				updateId: updated.updates.at(-1)?.id ?? "",
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_early",
			jobId: "njb_early",
			subscriberId: person.id,
			state: "pending",
		});
		await t.services.notificationJobs.process("njb_early");
		expect((await t.store.get("notification_jobs", "njb_early"))?.state).toBe(
			"done",
		);
		t.notifier.notifyIncident = original;

		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_orphan",
				incidentId: created.id,
				updateId: updated.updates.at(-1)?.id ?? "",
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_orphan",
			jobId: "njb_orphan",
			subscriberId: "sub_missing",
			state: "pending",
		});
		await t.services.notificationJobs.process("njb_orphan");
		expect(
			(await t.store.get("notification_deliveries", "ndl_orphan"))?.error,
		).toBe("not_sent");
		error.mockRestore();
	});

	it("does not mark a missing job when the queue refuses it", async () => {
		await webhook(t);
		const created = await incident(t);
		vi.spyOn(NotificationQueue.prototype, "open").mockResolvedValue("ok");
		await t.services.notificationQueue.update(ADMIN, {
			revision: 0,
			provider: "redis",
		});
		const enqueue = vi
			.spyOn(NotificationQueue.prototype, "enqueue")
			.mockImplementation(async (jobId) => {
				await t.store.delete("notification_jobs", jobId);
				return "enqueue";
			});
		await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Gone",
			notify: true,
		});
		expect(await t.store.find("notification_jobs", {})).toEqual([]);
		enqueue.mockImplementation(async (jobId) => {
			const job = await t.store.get("notification_jobs", jobId);
			if (job) {
				await t.store.update("notification_jobs", {
					...job,
					state: "done",
					finishedAt: t.clock.now().toISOString(),
				});
			}
			return "enqueue" as const;
		});
		await t.services.incidents.postUpdate(
			ADMIN,
			created.id,
			{ message: "Already done", notify: true },
			{ jobId: "njb_already" },
		);
		expect(
			(await t.store.get("notification_jobs", "njb_already"))?.fallback,
		).toBeUndefined();
		enqueue.mockRestore();
	});

	it("skips subscribers and claims that cannot send", async () => {
		const api = await t.services.catalog.create(ADMIN, { name: "API" });
		await t.services.catalog.create(ADMIN, { name: "Web" });
		await webhook(t);
		await t.services.subscribers.addSms(ADMIN, { phone: "+15551234567" });
		const created = await t.services.incidents.create(ADMIN, {
			title: "API errors",
			message: "Looking",
			serviceIds: [api.id],
			notify: true,
		});
		expect(t.notifier.incidents[0]?.subscribers).toHaveLength(1);
		const sent = t.notifier.incidents[0];
		if (!sent) {
			throw new Error("missing send");
		}
		const subscriber = sent.subscribers[0];
		if (!subscriber) {
			throw new Error("missing subscriber");
		}
		await t.services.notificationJobs.start({
			actor: ADMIN,
			notification: sent.notification,
			subscribers: [{ ...subscriber, confirmed: false }],
			channels: sent.channels,
		});
		expect(await t.store.find("notification_jobs", {})).toHaveLength(1);

		const updated = await t.services.incidents.postUpdate(ADMIN, created.id, {
			message: "Race",
			notify: false,
		});
		const updateId = updated.updates.at(-1)?.id ?? "";
		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_race",
				incidentId: created.id,
				updateId,
				queued: false,
			}),
		);
		await delivery(t, {
			id: "ndl_race",
			jobId: "njb_race",
			subscriberId: sent.subscribers[0]?.id ?? "",
			state: "pending",
		});
		const release = t.notifier.hold();
		const racing = Promise.all([
			t.services.notificationJobs.process("njb_race"),
			t.services.notificationJobs.process("njb_race"),
		]);
		await vi.waitFor(async () => {
			expect(
				(await t.store.get("notification_deliveries", "ndl_race"))?.state,
			).toBe("sending");
		});
		release();
		await racing;
		expect(t.notifier.incidents).toHaveLength(2);
		const rebuilt = t.notifier.incidents[1]?.notification.services.map(
			(service) => service.name,
		);
		expect(rebuilt).toEqual(["API"]);

		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_shift",
				incidentId: created.id,
				updateId,
				heartbeatAt: new Date(
					t.clock.now().getTime() - 16 * MINUTE,
				).toISOString(),
			}),
		);
		await delivery(t, {
			id: "ndl_shift",
			jobId: "njb_shift",
			subscriberId: sent.subscribers[0]?.id ?? "",
			state: "pending",
		});
		const find = t.store.find.bind(t.store);
		let shifted = false;
		const findSpy = vi
			.spyOn(t.store, "find")
			.mockImplementation(async (...args) => {
				const rows = await find(...args);
				if (!shifted && args[0] === "notification_jobs") {
					shifted = true;
					const job = (rows as NotificationJob[]).find(
						(row) => row.id === "njb_shift",
					);
					if (job) {
						await t.store.update("notification_jobs", {
							...job,
							heartbeatAt: t.clock.now().toISOString(),
						});
					}
				}
				return rows;
			});
		await t.services.notificationJobs.recover();
		expect((await t.store.get("notification_jobs", "njb_shift"))?.state).toBe(
			"active",
		);
		expect(
			(await t.store.get("notification_jobs", "njb_shift"))?.fallback,
		).toBeUndefined();
		findSpy.mockRestore();

		await t.store.insert(
			"notification_jobs",
			jobDocument(t, {
				id: "njb_direct",
				incidentId: created.id,
				updateId,
				queued: false,
				heartbeatAt: new Date(
					t.clock.now().getTime() - 3 * MINUTE,
				).toISOString(),
			}),
		);
		await delivery(t, {
			id: "ndl_direct",
			jobId: "njb_direct",
			subscriberId: sent.subscribers[0]?.id ?? "",
			state: "pending",
		});
		t.clock.advance(10_000);
		await t.services.notificationJobs.recover();
		await vi.waitFor(async () => {
			expect(
				(await t.store.get("notification_jobs", "njb_direct"))?.state,
			).toBe("done");
		});
		expect(
			(await t.store.get("notification_jobs", "njb_direct"))?.fallback,
		).toBeUndefined();
	});

	it("does not create a job when nobody can receive the notice", async () => {
		const created = await t.services.incidents.create(ADMIN, {
			title: "Quiet",
			message: "Looking",
			notify: true,
		});
		expect(await t.store.find("notification_jobs", {})).toEqual([]);
		expect(created.title).toBe("Quiet");
	});
});
