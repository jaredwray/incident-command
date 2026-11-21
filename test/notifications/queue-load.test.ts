import { ADMIN, createTestContext } from "../helpers";

const state = vi.hoisted(() => ({ imports: 0 }));

vi.mock("@/lib/notifications/queue-providers", () => {
	state.imports += 1;
	throw new Error("Cannot find module 'qified'");
});

describe("queue package load", () => {
	it("does not load the queue package for a direct send", async () => {
		const t = createTestContext();
		await t.services.subscribers.addWebhook(ADMIN, {
			url: "https://hooks.example.com/a",
		});
		await t.services.incidents.create(ADMIN, {
			title: "API errors",
			message: "Looking",
			notify: true,
		});
		expect(state.imports).toBe(0);
		expect(t.notifier.incidents).toHaveLength(1);
	});

	it("sends in this process when the queue package does not load", async () => {
		const t = createTestContext();
		const saved = await t.services.notificationQueue.update(ADMIN, {
			revision: 0,
			provider: "redis",
		});
		expect(saved.ready).toBe(false);
		expect(state.imports).toBeGreaterThan(0);
		await t.services.subscribers.addWebhook(ADMIN, {
			url: "https://hooks.example.com/a",
		});
		await t.services.incidents.create(ADMIN, {
			title: "API errors",
			message: "Looking",
			notify: true,
		});
		await vi.waitFor(async () => {
			const jobs = await t.store.find("notification_jobs", {});
			expect(jobs[0]).toMatchObject({ fallback: "load", state: "done" });
		});
		expect(t.notifier.incidents).toHaveLength(1);
		expect(t.notifier.incidents[0]?.notification.incident.title).toBe(
			"API errors",
		);
	});
});
