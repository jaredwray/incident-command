import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@/lib/errors";
import { memberActor, toPublicMember } from "@/lib/services/members";
import { ADMIN, createTestContext, EDITOR, type TestContext } from "../helpers";

describe("MemberService and SessionService", () => {
	let t: TestContext;
	beforeEach(() => {
		t = createTestContext();
	});

	it("sets up the first admin exactly once", async () => {
		const admin = await t.services.members.setup({
			email: "Ada@Acme.dev",
			name: "Ada",
			password: "password123",
		});
		expect(admin).toMatchObject({ email: "ada@acme.dev", role: "admin" });
		expect(admin).not.toHaveProperty("passwordHash");
		await expect(
			t.services.members.setup({
				email: "b@acme.dev",
				name: "B",
				password: "password123",
			}),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("requires the setup token when configured", async () => {
		const guarded = createTestContext({ env: { SETUP_TOKEN: "letmein" } });
		const input = { email: "a@acme.dev", name: "A", password: "password123" };
		await expect(guarded.services.members.setup(input)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(
			guarded.services.members.setup(input, "wrong"),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			guarded.services.members.setup(input, "letmein"),
		).resolves.toMatchObject({ role: "admin" });
	});

	it("creates, lists, updates and deletes members", async () => {
		const admin = await t.services.members.setup({
			email: "admin@acme.dev",
			name: "Admin",
			password: "password123",
		});
		const actor = memberActor(admin);
		const ed = await t.services.members.create(actor, {
			email: "ed@acme.dev",
			name: "Ed",
			password: "password123",
		});
		expect(ed.role).toBe("editor");
		await expect(
			t.services.members.create(actor, {
				email: "ed@acme.dev",
				name: "Ed2",
				password: "password123",
			}),
		).rejects.toBeInstanceOf(ConflictError);
		expect((await t.services.members.list(actor)).map((m) => m.email)).toEqual([
			"admin@acme.dev",
			"ed@acme.dev",
		]);
		await expect(t.services.members.count()).resolves.toBe(2);
		await expect(t.services.members.get(ed.id)).resolves.toMatchObject({
			name: "Ed",
		});
		await expect(t.services.members.get("nope")).resolves.toBeUndefined();

		const promoted = await t.services.members.update(actor, ed.id, {
			role: "admin",
			name: "Edward",
			email: "edward@acme.dev",
		});
		expect(promoted).toMatchObject({
			role: "admin",
			name: "Edward",
			email: "edward@acme.dev",
		});
		await expect(
			t.services.members.update(actor, ed.id, { email: "admin@acme.dev" }),
		).rejects.toBeInstanceOf(ConflictError);
		await expect(
			t.services.members.update(actor, ed.id, { email: "edward@acme.dev" }),
		).resolves.toBeDefined();
		await t.services.members.update(actor, ed.id, { role: "viewer" });
		await t.services.members.update(actor, ed.id, { role: "editor" });

		await t.services.members.delete(actor, ed.id);
		await expect(
			t.services.members.delete(actor, ed.id),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(t.services.members.list(EDITOR)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});

	it("never removes or demotes the last admin", async () => {
		const admin = await t.services.members.setup({
			email: "admin@acme.dev",
			name: "Admin",
			password: "password123",
		});
		const actor = memberActor(admin);
		await expect(
			t.services.members.update(actor, admin.id, { role: "editor" }),
		).rejects.toThrow(/last admin/);
		await expect(t.services.members.delete(actor, admin.id)).rejects.toThrow(
			/last admin/,
		);
		const second = await t.services.members.create(actor, {
			email: "b@acme.dev",
			name: "B",
			password: "password123",
			role: "admin",
		});
		await t.services.members.delete(actor, second.id);
	});

	it("authenticates members and records the login time", async () => {
		await t.services.members.setup({
			email: "admin@acme.dev",
			name: "Admin",
			password: "password123",
		});
		await expect(
			t.services.members.authenticate({
				email: "ADMIN@acme.dev",
				password: "password123",
			}),
		).resolves.toMatchObject({
			lastLoginAt: "2026-11-02T12:00:00.000Z",
		});
		await expect(
			t.services.members.authenticate({
				email: "admin@acme.dev",
				password: "wrong",
			}),
		).resolves.toBeUndefined();
		await expect(
			t.services.members.authenticate({
				email: "nobody@acme.dev",
				password: "password123",
			}),
		).resolves.toBeUndefined();
		await expect(
			t.services.members.authenticate({ email: "bad", password: "" }),
		).resolves.toBeUndefined();
	});

	it("changes passwords and revokes sessions on admin resets", async () => {
		const admin = await t.services.members.setup({
			email: "admin@acme.dev",
			name: "Admin",
			password: "password123",
		});
		const actor = memberActor(admin);
		await expect(
			t.services.members.changePassword(actor, "wrong", "newpassword1"),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.members.changePassword(actor, "password123", "short"),
		).rejects.toBeInstanceOf(ValidationError);
		await t.services.members.changePassword(
			actor,
			"password123",
			"newpassword1",
		);
		await expect(
			t.services.members.authenticate({
				email: "admin@acme.dev",
				password: "newpassword1",
			}),
		).resolves.toBeDefined();

		const { token } = await t.services.sessions.create(admin.id);
		await expect(t.services.sessions.resolve(token)).resolves.toBeDefined();
		await t.services.members.update(actor, admin.id, {
			password: "anotherpass1",
		});
		await expect(t.services.sessions.resolve(token)).resolves.toBeUndefined();
	});

	it("manages session lifecycle", async () => {
		const admin = await t.services.members.setup({
			email: "admin@acme.dev",
			name: "Admin",
			password: "password123",
		});
		const { token, session } = await t.services.sessions.create(admin.id);
		expect(session.id).not.toBe(token);
		expect(session.expiresAt).toBe("2026-11-09T12:00:00.000Z");
		await expect(t.services.sessions.resolve(token)).resolves.toMatchObject({
			member: { id: admin.id },
		});
		await expect(
			t.services.sessions.resolve(undefined),
		).resolves.toBeUndefined();
		await expect(t.services.sessions.resolve("bogus")).resolves.toBeUndefined();

		await t.services.sessions.destroy(token);
		await t.services.sessions.destroy(undefined);
		await expect(t.services.sessions.resolve(token)).resolves.toBeUndefined();

		const expiring = await t.services.sessions.create(admin.id);
		t.clock.advance(8 * 86_400_000);
		await expect(
			t.services.sessions.resolve(expiring.token),
		).resolves.toBeUndefined();
		expect(await t.store.count("sessions")).toBe(0);

		// expired sessions are swept when new ones are created
		await t.services.sessions.create(admin.id);
		t.clock.advance(8 * 86_400_000);
		await t.services.sessions.create(admin.id);
		expect(await t.store.count("sessions")).toBe(1);

		// sessions of deleted members do not resolve
		const orphan = await t.services.sessions.create("mem_gone");
		await expect(
			t.services.sessions.resolve(orphan.token),
		).resolves.toBeUndefined();
	});

	it("maps members to public views and actors", () => {
		const member = {
			id: "m",
			email: "e",
			name: "n",
			role: "editor" as const,
			passwordHash: "secret",
			createdAt: "",
			updatedAt: "",
		};
		expect(toPublicMember(member)).not.toHaveProperty("passwordHash");
		expect(memberActor(member)).toEqual({
			type: "member",
			id: "m",
			name: "n",
			role: "editor",
		});
		expect(ADMIN.role).toBe("admin");
	});
});
