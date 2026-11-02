import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@/lib/errors";
import { ADMIN, createTestContext, EDITOR, type TestContext } from "../helpers";

describe("SubscriberService", () => {
	let t: TestContext;
	beforeEach(() => {
		t = createTestContext();
	});

	it("runs the double opt-in flow", async () => {
		await expect(t.services.subscribers.canSubscribe()).resolves.toBe(true);
		await expect(
			t.services.subscribers.subscribe({ email: "Jane@Example.com" }),
		).resolves.toBe("confirmation_sent");
		const [pending] = t.notifier.confirmations;
		expect(pending).toMatchObject({
			target: "jane@example.com",
			confirmed: false,
			type: "email",
		});
		await expect(t.services.subscribers.recipients()).resolves.toEqual([]);

		// re-subscribing before confirming resends without duplicating
		await t.services.subscribers.subscribe({ email: "jane@example.com" });
		expect(t.notifier.confirmations).toHaveLength(2);
		expect(await t.store.count("subscribers")).toBe(1);

		const confirmed = await t.services.subscribers.confirm(
			pending?.token ?? "",
		);
		expect(confirmed).toMatchObject({
			confirmed: true,
			confirmedAt: "2026-11-02T12:00:00.000Z",
		});
		await expect(
			t.services.subscribers.confirm(pending?.token ?? ""),
		).resolves.toMatchObject({ confirmed: true });
		await expect(t.services.subscribers.recipients()).resolves.toHaveLength(1);
		await expect(
			t.services.subscribers.subscribe({ email: "jane@example.com" }),
		).resolves.toBe("already_subscribed");

		await expect(
			t.services.subscribers.unsubscribe(pending?.token ?? ""),
		).resolves.toBe(true);
		await expect(
			t.services.subscribers.unsubscribe(pending?.token ?? ""),
		).resolves.toBe(false);
	});

	it("rejects bad tokens and invalid emails", async () => {
		await expect(
			t.services.subscribers.confirm("nope"),
		).resolves.toBeUndefined();
		await expect(t.services.subscribers.confirm("")).resolves.toBeUndefined();
		await expect(
			t.services.subscribers.subscribe({ email: "not-an-email" }),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("refuses public subscriptions when disabled or email is not configured", async () => {
		await t.services.settings.update(ADMIN, { allowSubscriptions: false });
		await expect(
			t.services.subscribers.subscribe({ email: "a@b.co" }),
		).rejects.toBeInstanceOf(ForbiddenError);
		const noEmail = createTestContext();
		noEmail.notifier.emailEnabled = false;
		await expect(noEmail.services.subscribers.canSubscribe()).resolves.toBe(
			false,
		);
	});

	it("lets admins manage webhook and email subscribers", async () => {
		const hook = await t.services.subscribers.addWebhook(ADMIN, {
			url: "https://hooks.slack.com/services/x",
		});
		expect(hook).toMatchObject({
			type: "webhook",
			confirmed: true,
			confirmedAt: "2026-11-02T12:00:00.000Z",
		});
		t.clock.advance(1000);
		const email = await t.services.subscribers.addEmail(ADMIN, {
			email: "ops@acme.dev",
		});
		expect(email.confirmed).toBe(true);
		expect((await t.services.subscribers.list(ADMIN)).map((s) => s.id)).toEqual(
			[email.id, hook.id],
		);
		await expect(
			t.services.subscribers.addEmail(ADMIN, { email: "ops@acme.dev" }),
		).rejects.toBeInstanceOf(ConflictError);
		await t.services.subscribers.remove(ADMIN, hook.id);
		await expect(
			t.services.subscribers.remove(ADMIN, hook.id),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.subscribers.addWebhook(ADMIN, { url: "ftp://x" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(t.services.subscribers.list(EDITOR)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});
});
