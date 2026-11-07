import type { Actor, Role } from "@/lib/domain/types";
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

	/** Invites a person and accepts the invite for them. */
	async function join(actor: Actor, email: string, name: string, role?: Role) {
		const { token } = await t.services.members.invite(actor, { email, role });
		return t.services.members.acceptInvite(token, {
			name,
			password: "password123",
		});
	}

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

	it("invites members with one-time links", async () => {
		const admin = await t.services.members.setup({
			email: "admin@acme.dev",
			name: "Admin",
			password: "password123",
		});
		const actor = memberActor(admin);
		await expect(
			t.services.members.invite(EDITOR, { email: "ed@acme.dev" }),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(t.services.members.listInvites(EDITOR)).rejects.toBeInstanceOf(
			ForbiddenError,
		);
		await expect(
			t.services.members.invite(actor, { email: "Admin@acme.dev" }),
		).rejects.toBeInstanceOf(ConflictError);

		const first = await t.services.members.invite(actor, {
			email: "Ed@Acme.dev",
		});
		expect(first.invite).toMatchObject({
			email: "ed@acme.dev",
			role: "editor",
			invitedBy: { type: "member", id: admin.id, name: "Admin" },
			expiresAt: "2026-11-09T12:00:00.000Z",
		});
		expect(first.invite).not.toHaveProperty("tokenHash");

		// a new invite for the same email replaces the old link
		t.clock.advance(1000);
		const second = await t.services.members.invite(actor, {
			email: "ed@acme.dev",
			role: "viewer",
		});
		await expect(
			t.services.members.findInvite(first.token),
		).resolves.toBeUndefined();
		await expect(
			t.services.members.findInvite(second.token),
		).resolves.toMatchObject({ id: second.invite.id, role: "viewer" });
		t.clock.advance(1000);
		const other = await t.services.members.invite(actor, {
			email: "vi@acme.dev",
		});
		expect(
			(await t.services.members.listInvites(actor)).map((i) => i.email),
		).toEqual(["vi@acme.dev", "ed@acme.dev"]);

		// bad input does not use up the link
		await expect(
			t.services.members.acceptInvite(second.token, {
				name: "",
				password: "short",
			}),
		).rejects.toBeInstanceOf(ValidationError);
		const ed = await t.services.members.acceptInvite(second.token, {
			name: " Ed ",
			password: "password123",
		});
		expect(ed).toMatchObject({
			email: "ed@acme.dev",
			name: "Ed",
			role: "viewer",
		});
		await expect(
			t.services.members.authenticate({
				email: "ed@acme.dev",
				password: "password123",
			}),
		).resolves.toMatchObject({ id: ed.id });
		await expect(
			t.services.members.acceptInvite(second.token, {
				name: "Ed again",
				password: "password123",
			}),
		).rejects.toMatchObject({ code: "not_found" });

		await t.services.members.revokeInvite(actor, other.invite.id);
		await expect(
			t.services.members.revokeInvite(actor, other.invite.id),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			t.services.members.findInvite(other.token),
		).resolves.toBeUndefined();
		await expect(t.services.members.listInvites(actor)).resolves.toEqual([]);
	});

	it("rejects expired invite links", async () => {
		const { token } = await t.services.members.invite(ADMIN, {
			email: "late@acme.dev",
		});
		t.clock.advance(7 * 86_400_000);
		await expect(t.services.members.findInvite(token)).resolves.toBeUndefined();
		await expect(
			t.services.members.acceptInvite(token, {
				name: "Late",
				password: "password123",
			}),
		).rejects.toMatchObject({ code: "not_found" });
		await expect(t.services.members.count()).resolves.toBe(0);
	});

	it("renews open invite links and stops the old link", async () => {
		const first = await t.services.members.invite(ADMIN, {
			email: "ed@acme.dev",
			role: "viewer",
		});
		t.clock.advance(86_400_000);
		await expect(
			t.services.members.renewInvite(EDITOR, first.invite.id),
		).rejects.toBeInstanceOf(ForbiddenError);
		const renewed = await t.services.members.renewInvite(
			ADMIN,
			first.invite.id,
		);
		expect(renewed.invite).toEqual(first.invite);
		await expect(
			t.services.members.findInvite(first.token),
		).resolves.toBeUndefined();
		await expect(t.services.members.findInvite(renewed.token)).resolves.toEqual(
			first.invite,
		);

		// a used invite has no link to renew
		await t.services.members.acceptInvite(renewed.token, {
			name: "Ed",
			password: "password123",
		});
		await expect(
			t.services.members.renewInvite(ADMIN, first.invite.id),
		).rejects.toBeInstanceOf(NotFoundError);

		const late = await t.services.members.invite(ADMIN, {
			email: "late@acme.dev",
		});
		t.clock.advance(7 * 86_400_000);
		await expect(
			t.services.members.renewInvite(ADMIN, late.invite.id),
		).rejects.toMatchObject({
			code: "not_found",
			message: "This invite expired or was used. Invite the email again.",
		});
	});

	it("lists, updates and deletes members", async () => {
		const admin = await t.services.members.setup({
			email: "admin@acme.dev",
			name: "Admin",
			password: "password123",
		});
		const actor = memberActor(admin);
		const ed = await join(actor, "ed@acme.dev", "Ed");
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
		const second = await join(actor, "b@acme.dev", "B", "admin");
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
