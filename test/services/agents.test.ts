import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isAgentActive, TOKEN_PREFIX } from "@/lib/services/agents";
import { ADMIN, createTestContext, EDITOR, type TestContext } from "../helpers";

describe("AgentService", () => {
	let t: TestContext;
	beforeEach(() => {
		t = createTestContext();
	});

	it("creates tokens that authenticate as agents", async () => {
		const { token, agent } = await t.services.agents.create(ADMIN, {
			name: "Ops bot",
			description: "PagerDuty bridge",
			role: "editor",
		});
		expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
		expect(agent).not.toHaveProperty("tokenHash");
		expect(agent).toMatchObject({
			name: "Ops bot",
			description: "PagerDuty bridge",
			role: "editor",
			tokenPrefix: token.slice(0, 11),
		});
		expect(agent.expiresAt).toBeUndefined();

		await expect(t.services.agents.authenticate(token)).resolves.toEqual({
			type: "agent",
			id: agent.id,
			name: "Ops bot",
			role: "editor",
		});
		const [listed] = await t.services.agents.list(ADMIN);
		expect(listed?.lastUsedAt).toBe("2026-11-02T12:00:00.000Z");

		// lastUsedAt is only refreshed once per minute
		t.clock.advance(30_000);
		await t.services.agents.authenticate(token);
		expect((await t.services.agents.list(ADMIN))[0]?.lastUsedAt).toBe(
			"2026-11-02T12:00:00.000Z",
		);
		t.clock.advance(60_000);
		await t.services.agents.authenticate(token);
		expect((await t.services.agents.list(ADMIN))[0]?.lastUsedAt).toBe(
			"2026-11-02T12:01:30.000Z",
		);
	});

	it("rejects unknown, malformed, revoked and expired tokens", async () => {
		await expect(
			t.services.agents.authenticate(undefined),
		).resolves.toBeUndefined();
		await expect(
			t.services.agents.authenticate("Bearer nope"),
		).resolves.toBeUndefined();
		await expect(
			t.services.agents.authenticate(`${TOKEN_PREFIX}unknown`),
		).resolves.toBeUndefined();

		const revoked = await t.services.agents.create(ADMIN, { name: "Revoked" });
		const revokedView = await t.services.agents.revoke(ADMIN, revoked.agent.id);
		expect(revokedView.revokedAt).toBe("2026-11-02T12:00:00.000Z");
		t.clock.advance(1000);
		expect(
			(await t.services.agents.revoke(ADMIN, revoked.agent.id)).revokedAt,
		).toBe("2026-11-02T12:00:00.000Z");
		await expect(
			t.services.agents.authenticate(revoked.token),
		).resolves.toBeUndefined();

		const expiring = await t.services.agents.create(ADMIN, {
			name: "Temp",
			expiresInDays: 1,
			role: "viewer",
		});
		expect(expiring.agent.expiresAt).toBe("2026-11-03T12:00:01.000Z");
		await expect(
			t.services.agents.authenticate(expiring.token),
		).resolves.toMatchObject({ role: "viewer" });
		t.clock.advance(2 * 86_400_000);
		await expect(
			t.services.agents.authenticate(expiring.token),
		).resolves.toBeUndefined();
	});

	it("reports active state", () => {
		const now = new Date("2026-11-02T12:00:00.000Z");
		expect(isAgentActive({ revokedAt: "x" } as never, now)).toBe(false);
		expect(
			isAgentActive({ expiresAt: "2026-11-01T00:00:00.000Z" } as never, now),
		).toBe(false);
		expect(
			isAgentActive({ expiresAt: "2026-12-01T00:00:00.000Z" } as never, now),
		).toBe(true);
		expect(isAgentActive({} as never, now)).toBe(true);
	});

	it("deletes tokens and enforces admin", async () => {
		const { agent } = await t.services.agents.create(ADMIN, { name: "Bot" });
		await t.services.agents.delete(ADMIN, agent.id);
		await expect(
			t.services.agents.delete(ADMIN, agent.id),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.agents.revoke(ADMIN, agent.id),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.agents.create(EDITOR, { name: "x" }),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			t.services.agents.create(ADMIN, { name: "" }),
		).rejects.toBeInstanceOf(ValidationError);
	});
});
