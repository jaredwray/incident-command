import { createId, hashPassword, verifyPassword } from "../crypto";
import {
	type CreateMemberInput,
	createMemberSchema,
	loginSchema,
	type UpdateMemberInput,
	updateMemberSchema,
} from "../domain/schemas";
import type { Actor, Member, PublicMember } from "../domain/types";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "../errors";
import { iso, parse, requireRole, type ServiceContext } from "./context";
import type { SessionService } from "./sessions";

export function toPublicMember(member: Member): PublicMember {
	const { passwordHash: _passwordHash, ...rest } = member;
	return rest;
}

export function memberActor(member: Member | PublicMember): Actor {
	return {
		type: "member",
		id: member.id,
		name: member.name,
		role: member.role,
	};
}

export class MemberService {
	private readonly ctx: ServiceContext;
	private readonly sessions: SessionService;

	constructor(ctx: ServiceContext, sessions: SessionService) {
		this.ctx = ctx;
		this.sessions = sessions;
	}

	async count(): Promise<number> {
		return this.ctx.store.count("members");
	}

	async list(actor: Actor): Promise<PublicMember[]> {
		requireRole(actor, "admin");
		const members = await this.ctx.store.find("members", {
			sort: [{ field: "createdAt" }],
		});
		return members.map(toPublicMember);
	}

	async get(id: string): Promise<PublicMember | undefined> {
		const member = await this.ctx.store.get("members", id);
		return member ? toPublicMember(member) : undefined;
	}

	async create(actor: Actor, input: CreateMemberInput): Promise<PublicMember> {
		requireRole(actor, "admin");
		return this.insert(input);
	}

	/**
	 * Creates the very first admin. Only allowed while no members exist, and
	 * when a setup token is configured it must match.
	 */
	async setup(
		input: Omit<CreateMemberInput, "role">,
		token?: string,
	): Promise<PublicMember> {
		const expected = this.ctx.config.setupToken;
		if (expected && token !== expected) {
			throw new ForbiddenError("Invalid setup token");
		}
		if ((await this.count()) > 0) {
			throw new ConflictError("Setup has already been completed");
		}
		return this.insert({ ...input, role: "admin" });
	}

	async update(
		actor: Actor,
		id: string,
		input: UpdateMemberInput,
	): Promise<PublicMember> {
		requireRole(actor, "admin");
		const patch = parse(updateMemberSchema, input);
		const current = await this.load(id);
		if (patch.role && patch.role !== "admin" && current.role === "admin") {
			await this.assertNotLastAdmin();
		}
		if (patch.email && patch.email !== current.email) {
			await this.assertEmailAvailable(patch.email);
		}
		const next: Member = {
			...current,
			email: patch.email ?? current.email,
			name: patch.name ?? current.name,
			role: patch.role ?? current.role,
			passwordHash: patch.password
				? await hashPassword(patch.password)
				: current.passwordHash,
			updatedAt: iso(this.ctx.now()),
		};
		await this.ctx.store.update("members", next);
		if (patch.password) {
			await this.sessions.destroyForMember(id);
		}
		return toPublicMember(next);
	}

	/** Lets any member change their own password after confirming the current one. */
	async changePassword(
		actor: Actor,
		currentPassword: string,
		newPassword: string,
	): Promise<void> {
		const member = await this.load(actor.id);
		if (!(await verifyPassword(currentPassword, member.passwordHash))) {
			throw new ValidationError("Current password is incorrect");
		}
		parse(updateMemberSchema, { password: newPassword });
		await this.ctx.store.update("members", {
			...member,
			passwordHash: await hashPassword(newPassword),
			updatedAt: iso(this.ctx.now()),
		});
	}

	async delete(actor: Actor, id: string): Promise<void> {
		requireRole(actor, "admin");
		const member = await this.load(id);
		if (member.role === "admin") {
			await this.assertNotLastAdmin();
		}
		await this.ctx.store.delete("members", id);
		await this.sessions.destroyForMember(id);
	}

	/** Verifies credentials. Resolves `undefined` for unknown emails or bad passwords. */
	async authenticate(input: {
		email: string;
		password: string;
	}): Promise<PublicMember | undefined> {
		const result = loginSchema.safeParse(input);
		if (!result.success) {
			return undefined;
		}
		const [member] = await this.ctx.store.find("members", {
			where: [{ field: "email", op: "eq", value: result.data.email }],
			limit: 1,
		});
		if (
			!member ||
			!(await verifyPassword(result.data.password, member.passwordHash))
		) {
			return undefined;
		}
		const next = { ...member, lastLoginAt: iso(this.ctx.now()) };
		await this.ctx.store.update("members", next);
		return toPublicMember(next);
	}

	private async insert(input: CreateMemberInput): Promise<PublicMember> {
		const data = parse(createMemberSchema, input);
		await this.assertEmailAvailable(data.email);
		const now = iso(this.ctx.now());
		const member: Member = {
			id: createId("mem"),
			email: data.email,
			name: data.name,
			role: data.role ?? "editor",
			passwordHash: await hashPassword(data.password),
			createdAt: now,
			updatedAt: now,
		};
		await this.ctx.store.insert("members", member);
		return toPublicMember(member);
	}

	private async load(id: string): Promise<Member> {
		const member = await this.ctx.store.get("members", id, {
			consistent: true,
		});
		if (!member) {
			throw new NotFoundError("Member", id);
		}
		return member;
	}

	private async assertEmailAvailable(email: string): Promise<void> {
		const count = await this.ctx.store.count("members", {
			where: [{ field: "email", op: "eq", value: email }],
		});
		if (count > 0) {
			throw new ConflictError("A member with that email already exists");
		}
	}

	private async assertNotLastAdmin(): Promise<void> {
		const admins = await this.ctx.store.count("members", {
			where: [{ field: "role", op: "eq", value: "admin" }],
		});
		if (admins <= 1) {
			throw new ConflictError("You cannot remove the last admin");
		}
	}
}
