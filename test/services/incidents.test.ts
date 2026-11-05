import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
	ADMIN,
	createTestContext,
	EDITOR,
	type TestContext,
	VIEWER,
} from "../helpers";

describe("IncidentService", () => {
	let t: TestContext;
	let api: string;
	let web: string;

	beforeEach(async () => {
		t = createTestContext();
		api = (await t.services.catalog.create(ADMIN, { name: "API" })).id;
		web = (await t.services.catalog.create(ADMIN, { name: "Web" })).id;
		await t.services.subscribers.addWebhook(ADMIN, {
			url: "https://hooks.example.com/x",
		});
	});

	const statusOf = async (id: string) =>
		(await t.services.catalog.get(id)).status;

	it("creates an incident, sets service status and notifies", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "API errors",
			message: "Investigating elevated errors",
			impact: "critical",
			serviceIds: [api, api],
		});
		expect(incident).toMatchObject({
			kind: "incident",
			status: "investigating",
			impact: "critical",
			serviceIds: [api],
			createdBy: { type: "member", id: EDITOR.id, name: EDITOR.name },
			startedAt: "2026-11-02T12:00:00.000Z",
		});
		expect(incident.id).toMatch(/^inc_/);
		expect(incident.updates).toHaveLength(1);
		expect(incident.updates[0]?.message).toBe("Investigating elevated errors");
		expect(await statusOf(api)).toBe("major_outage");
		expect(await statusOf(web)).toBe("operational");
		expect(t.notifier.incidents).toHaveLength(1);
		expect(t.notifier.incidents[0]?.notification.event).toBe(
			"incident.created",
		);
		expect(
			t.notifier.incidents[0]?.notification.services.map((c) => c.id),
		).toEqual([api]);
		await expect(t.services.incidents.get(incident.id)).resolves.toEqual(
			incident,
		);
	});

	it("defaults impact to minor and respects an explicit service status", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Slow",
			message: "Slow pages",
			serviceIds: [web],
			serviceStatus: "partial_outage",
			notify: false,
		});
		expect(incident.impact).toBe("minor");
		expect(await statusOf(web)).toBe("partial_outage");
		expect(t.notifier.incidents).toHaveLength(0);
	});

	it("leaves services alone for impact none", async () => {
		await t.services.catalog.setStatus(EDITOR, web, "degraded_performance");
		await t.services.incidents.create(EDITOR, {
			title: "FYI",
			message: "Heads up",
			impact: "none",
			serviceIds: [web],
		});
		expect(await statusOf(web)).toBe("degraded_performance");
	});

	it("can be created already resolved (retroactive)", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Earlier blip",
			message: "Resolved",
			status: "resolved",
			serviceIds: [api],
		});
		expect(incident.resolvedAt).toBe("2026-11-02T12:00:00.000Z");
		expect(await statusOf(api)).toBe("operational");
	});

	it("validates status, services and permissions", async () => {
		await expect(
			t.services.incidents.create(VIEWER, { title: "x", message: "y" }),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			t.services.incidents.create(EDITOR, {
				title: "x",
				message: "y",
				status: "scheduled",
			}),
		).rejects.toThrow(/not valid for incident/);
		await expect(
			t.services.incidents.create(EDITOR, {
				title: "x",
				message: "y",
				serviceIds: ["nope"],
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.incidents.create(EDITOR, { title: "", message: "y" }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("posts updates and resolves, restoring services and notifying", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Down",
			message: "Down",
			impact: "major",
			serviceIds: [api],
		});
		t.clock.advance(60_000);
		const identified = await t.services.incidents.postUpdate(
			EDITOR,
			incident.id,
			{ status: "identified", message: "Found it" },
		);
		expect(identified.updates).toHaveLength(2);
		expect(identified.status).toBe("identified");
		expect(await statusOf(api)).toBe("partial_outage");

		const noted = await t.services.incidents.postUpdate(ADMIN, incident.id, {
			message: "Still working",
			serviceStatus: "degraded_performance",
		});
		expect(noted.status).toBe("identified");
		expect(await statusOf(api)).toBe("degraded_performance");

		t.clock.advance(60_000);
		const resolved = await t.services.incidents.resolve(EDITOR, incident.id);
		expect(resolved.status).toBe("resolved");
		expect(resolved.resolvedAt).toBe("2026-11-02T12:02:00.000Z");
		expect(resolved.updates.at(-1)?.message).toBe(
			"This incident has been resolved.",
		);
		expect(await statusOf(api)).toBe("operational");
		expect(t.notifier.incidents.map((n) => n.notification.event)).toEqual([
			"incident.created",
			"incident.updated",
			"incident.updated",
			"incident.resolved",
		]);

		// a post-resolution note neither re-notifies as resolved nor touches services
		await t.services.catalog.setStatus(EDITOR, api, "major_outage");
		const note = await t.services.incidents.postUpdate(EDITOR, incident.id, {
			message: "Postmortem published",
		});
		expect(note.resolvedAt).toBe("2026-11-02T12:02:00.000Z");
		expect(await statusOf(api)).toBe("major_outage");
		expect(t.notifier.incidents.at(-1)?.notification.event).toBe(
			"incident.updated",
		);

		// reopening clears resolvedAt
		const reopened = await t.services.incidents.postUpdate(
			EDITOR,
			incident.id,
			{ status: "investigating", message: "It's back" },
		);
		expect(reopened.resolvedAt).toBeUndefined();

		// resolving again with an explicit status applies it
		await t.services.incidents.postUpdate(EDITOR, incident.id, {
			status: "resolved",
			message: "Done",
			serviceStatus: "degraded_performance",
		});
		expect(await statusOf(api)).toBe("degraded_performance");
		// explicit status on an already-closed incident is still applied
		await t.services.incidents.postUpdate(EDITOR, incident.id, {
			message: "All clear",
			serviceStatus: "operational",
		});
		expect(await statusOf(api)).toBe("operational");
	});

	it("does not restore services still affected by another open incident", async () => {
		const first = await t.services.incidents.create(EDITOR, {
			title: "A",
			message: "A",
			impact: "critical",
			serviceIds: [api, web],
		});
		await t.services.incidents.create(EDITOR, {
			title: "B",
			message: "B",
			impact: "critical",
			serviceIds: [api],
		});
		await t.services.incidents.resolve(EDITOR, first.id, "First fixed");
		expect(await statusOf(api)).toBe("major_outage");
		expect(await statusOf(web)).toBe("operational");
	});

	it("skips services that were deleted", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "A",
			message: "A",
			impact: "critical",
			serviceIds: [api, web],
		});
		await t.services.catalog.delete(EDITOR, web);
		await t.services.incidents.resolve(EDITOR, incident.id);
		expect(await statusOf(api)).toBe("operational");
		expect(await t.services.incidents.affectedServices(incident)).toHaveLength(
			1,
		);
	});

	it("validates update status for the kind", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "A",
			message: "A",
		});
		await expect(
			t.services.incidents.postUpdate(EDITOR, incident.id, {
				status: "completed",
				message: "x",
			}),
		).rejects.toThrow(/not valid/);
		await expect(
			t.services.incidents.postUpdate(EDITOR, "inc_missing", { message: "x" }),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	describe("maintenance", () => {
		const window = {
			scheduledStart: "2026-11-03T02:00:00.000Z",
			scheduledEnd: "2026-11-03T04:00:00.000Z",
		};

		it("schedules, starts and completes maintenance", async () => {
			const maintenance = await t.services.incidents.create(EDITOR, {
				kind: "maintenance",
				title: "DB upgrade",
				message: "Upgrading Postgres",
				serviceIds: [api],
				...window,
			});
			expect(maintenance).toMatchObject({
				kind: "maintenance",
				status: "scheduled",
				impact: "none",
				startedAt: window.scheduledStart,
				...window,
			});
			expect(maintenance.id).toMatch(/^mnt_/);
			expect(await statusOf(api)).toBe("operational");

			await t.services.incidents.postUpdate(EDITOR, maintenance.id, {
				status: "in_progress",
				message: "Started",
			});
			expect(await statusOf(api)).toBe("under_maintenance");
			await t.services.incidents.postUpdate(EDITOR, maintenance.id, {
				status: "verifying",
				message: "Verifying",
			});
			expect(await statusOf(api)).toBe("under_maintenance");
			const done = await t.services.incidents.resolve(EDITOR, maintenance.id);
			expect(done.status).toBe("completed");
			expect(done.updates.at(-1)?.message).toBe(
				"This maintenance has been completed.",
			);
			expect(await statusOf(api)).toBe("operational");
			expect(t.notifier.incidents.map((n) => n.notification.event)).toEqual([
				"maintenance.scheduled",
				"maintenance.updated",
				"maintenance.updated",
				"maintenance.completed",
			]);
		});

		it("requires a valid window", async () => {
			await expect(
				t.services.incidents.create(EDITOR, {
					kind: "maintenance",
					title: "x",
					message: "y",
				}),
			).rejects.toThrow(/requires scheduledStart and scheduledEnd/);
			await expect(
				t.services.incidents.create(EDITOR, {
					kind: "maintenance",
					title: "x",
					message: "y",
					scheduledStart: window.scheduledEnd,
					scheduledEnd: window.scheduledStart,
				}),
			).rejects.toThrow(/scheduledEnd must be after/);
		});

		it("edits the window", async () => {
			const maintenance = await t.services.incidents.create(EDITOR, {
				kind: "maintenance",
				title: "x",
				message: "y",
				...window,
			});
			const edited = await t.services.incidents.edit(EDITOR, maintenance.id, {
				scheduledEnd: "2026-11-03T05:00:00.000Z",
			});
			expect(edited.scheduledEnd).toBe("2026-11-03T05:00:00.000Z");
			const moved = await t.services.incidents.edit(EDITOR, maintenance.id, {
				scheduledStart: "2026-11-03T03:00:00.000Z",
			});
			expect(moved.startedAt).toBe("2026-11-03T03:00:00.000Z");
			await expect(
				t.services.incidents.edit(EDITOR, maintenance.id, {
					scheduledStart: "2026-11-04T00:00:00.000Z",
				}),
			).rejects.toThrow(/scheduledEnd must be after/);
		});
	});

	it("edits incident metadata", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "A",
			message: "A",
			serviceIds: [api],
		});
		const edited = await t.services.incidents.edit(EDITOR, incident.id, {
			title: "Renamed",
			impact: "critical",
			serviceIds: [web],
		});
		expect(edited).toMatchObject({
			title: "Renamed",
			impact: "critical",
			serviceIds: [web],
		});
		const untouched = await t.services.incidents.edit(EDITOR, incident.id, {});
		expect(untouched).toMatchObject({ title: "Renamed", serviceIds: [web] });
		expect(untouched.scheduledStart).toBeUndefined();
	});

	it("lists with filters", async () => {
		const a = await t.services.incidents.create(EDITOR, {
			title: "A",
			message: "A",
		});
		t.clock.advance(1000);
		const b = await t.services.incidents.create(EDITOR, {
			title: "B",
			message: "B",
			status: "resolved",
		});
		t.clock.advance(1000);
		const m = await t.services.incidents.create(EDITOR, {
			kind: "maintenance",
			title: "M",
			message: "M",
			scheduledStart: "2026-11-05T00:00:00.000Z",
			scheduledEnd: "2026-11-05T01:00:00.000Z",
		});
		const ids = (list: { id: string }[]) => list.map((i) => i.id);
		expect(ids(await t.services.incidents.list())).toEqual([m.id, b.id, a.id]);
		expect(ids(await t.services.incidents.list({ kind: "incident" }))).toEqual([
			b.id,
			a.id,
		]);
		expect(ids(await t.services.incidents.list({ open: true }))).toEqual([
			m.id,
			a.id,
		]);
		expect(ids(await t.services.incidents.list({ open: false }))).toEqual([
			b.id,
		]);
		expect(
			ids(await t.services.incidents.list({ since: b.createdAt })),
		).toEqual([m.id, b.id]);
		expect(
			ids(await t.services.incidents.list({ before: b.createdAt })),
		).toEqual([a.id]);
		expect(ids(await t.services.incidents.list({ limit: 1 }))).toEqual([m.id]);
		await expect(t.services.incidents.find("nope")).resolves.toBeUndefined();
		await expect(t.services.incidents.get("nope")).rejects.toBeInstanceOf(
			NotFoundError,
		);
	});

	it("deletes incidents", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "A",
			message: "A",
		});
		await t.services.incidents.delete(EDITOR, incident.id);
		await expect(
			t.services.incidents.delete(EDITOR, incident.id),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.incidents.edit(EDITOR, incident.id, {}),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it("skips notifications without subscribers and survives notifier failures", async () => {
		const quiet = createTestContext();
		await quiet.services.incidents.create(EDITOR, { title: "A", message: "A" });
		expect(quiet.notifier.incidents).toHaveLength(0);

		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		t.notifier.fail = true;
		await expect(
			t.services.incidents.create(EDITOR, { title: "A", message: "A" }),
		).resolves.toBeDefined();
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("notifier exploded"),
		);

		vi.spyOn(t.services.subscribers, "recipients").mockRejectedValueOnce(
			"odd failure",
		);
		await t.services.incidents.create(EDITOR, { title: "B", message: "B" });
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("odd failure"));
		spy.mockRestore();
	});
});
