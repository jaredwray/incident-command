import { AppError, ConflictError } from "@/lib/errors";
import { toDateTimeInput } from "@/lib/format";
import { createTestContext, EDITOR, type TestContext } from "../helpers";

describe("concurrent incident writes", () => {
	let t: TestContext;
	beforeEach(() => {
		t = createTestContext();
	});

	it("keeps every update when two writers post at the same time", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Down",
			message: "Investigating",
		});
		expect(incident.revision).toBe(1);
		await Promise.all([
			t.services.incidents.postUpdate(EDITOR, incident.id, {
				message: "From agent A",
			}),
			t.services.incidents.postUpdate(EDITOR, incident.id, {
				message: "From agent B",
			}),
			t.services.incidents.edit(EDITOR, incident.id, {
				title: "Down (edited)",
			}),
		]);
		const saved = await t.services.incidents.get(incident.id);
		expect(saved.updates.map((update) => update.message).sort()).toEqual([
			"From agent A",
			"From agent B",
			"Investigating",
		]);
		expect(saved.title).toBe("Down (edited)");
		expect(saved.revision).toBe(4);
	});

	it("does not let a concurrent progress update undo a resolution", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Down",
			message: "Investigating",
		});
		await Promise.all([
			t.services.incidents.resolve(EDITOR, incident.id, "Fixed"),
			t.services.incidents.postUpdate(EDITOR, incident.id, {
				message: "Still digging",
			}),
		]);
		const saved = await t.services.incidents.get(incident.id);
		expect(saved.updates).toHaveLength(3);
		// whichever update landed last decides the status, and it is the one at the end of the timeline
		expect(saved.status).toBe(saved.updates.at(-1)?.status);
	});

	it("upgrades incidents stored without a revision", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Legacy",
			message: "x",
		});
		const { revision: _revision, ...legacy } = incident;
		await t.store.update("incidents", legacy);
		const updated = await t.services.incidents.postUpdate(EDITOR, incident.id, {
			message: "y",
		});
		expect(updated.revision).toBe(1);
	});

	it("gives up with a ConflictError when the incident keeps changing", async () => {
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Busy",
			message: "x",
		});
		const update = vi.spyOn(t.store, "update").mockResolvedValue(undefined);
		await expect(
			t.services.incidents.postUpdate(EDITOR, incident.id, { message: "y" }),
		).rejects.toBeInstanceOf(ConflictError);
		expect(update).toHaveBeenCalledTimes(5);
	});
});

describe("restoring components", () => {
	it("is not blocked by maintenance that is only scheduled", async () => {
		const t = createTestContext();
		const api = await t.services.components.create(EDITOR, { name: "API" });
		const incident = await t.services.incidents.create(EDITOR, {
			title: "Down",
			message: "x",
			impact: "critical",
			componentIds: [api.id],
		});
		await t.services.incidents.create(EDITOR, {
			kind: "maintenance",
			title: "Later",
			message: "Planned",
			componentIds: [api.id],
			scheduledStart: "2026-11-10T00:00:00.000Z",
			scheduledEnd: "2026-11-10T01:00:00.000Z",
		});
		await t.services.incidents.resolve(EDITOR, incident.id);
		expect((await t.services.components.get(api.id)).status).toBe(
			"operational",
		);
	});
});

describe("timestamps with offsets", () => {
	it("are stored and shown in UTC", async () => {
		const t = createTestContext();
		const maintenance = await t.services.incidents.create(EDITOR, {
			kind: "maintenance",
			title: "Window",
			message: "x",
			scheduledStart: "2026-11-03T02:00:00+02:00",
			scheduledEnd: "2026-11-03T04:30:00+02:00",
		});
		expect(maintenance.scheduledStart).toBe("2026-11-03T00:00:00.000Z");
		expect(maintenance.startedAt).toBe("2026-11-03T00:00:00.000Z");
		const edited = await t.services.incidents.edit(EDITOR, maintenance.id, {
			scheduledEnd: "2026-11-02T22:00:00-05:00",
		});
		expect(edited.scheduledEnd).toBe("2026-11-03T03:00:00.000Z");
		expect(toDateTimeInput("2026-11-03T02:00:00+02:00")).toBe(
			"2026-11-03T00:00",
		);
	});
});

describe("subscription confirmations", () => {
	it("fail loudly when the email cannot be sent", async () => {
		const t = createTestContext();
		t.notifier.confirmationResult = false;
		const attempt = t.services.subscribers.subscribe({
			email: "jane@example.com",
		});
		await expect(attempt).rejects.toBeInstanceOf(AppError);
		await expect(
			t.services.subscribers.subscribe({ email: "jane@example.com" }),
		).rejects.toThrow(/couldn't send the confirmation email/);
		t.notifier.confirmationResult = true;
		await expect(
			t.services.subscribers.subscribe({ email: "jane@example.com" }),
		).resolves.toBe("confirmation_sent");
		expect(await t.store.count("subscribers")).toBe(1);
	});
});
