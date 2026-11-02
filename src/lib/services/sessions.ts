import { createSecret, sha256 } from "../crypto";
import type { Member, Session } from "../domain/types";
import { iso, type ServiceContext } from "./context";

export interface SessionResult {
	session: Session;
	member: Member;
}

/** Database-backed sessions. Only a hash of the cookie token is stored. */
export class SessionService {
	private readonly ctx: ServiceContext;

	constructor(ctx: ServiceContext) {
		this.ctx = ctx;
	}

	async create(memberId: string): Promise<{ token: string; session: Session }> {
		const now = this.ctx.now();
		await this.ctx.store.deleteMany("sessions", {
			where: [{ field: "expiresAt", op: "lte", value: iso(now) }],
		});
		const token = createSecret(32);
		const session: Session = {
			id: sha256(token),
			memberId,
			createdAt: iso(now),
			expiresAt: iso(new Date(now.getTime() + this.ctx.config.sessionTtl)),
		};
		await this.ctx.store.insert("sessions", session);
		return { token, session };
	}

	async resolve(token: string | undefined): Promise<SessionResult | undefined> {
		if (!token) {
			return undefined;
		}
		const session = await this.ctx.store.get("sessions", sha256(token));
		if (!session) {
			return undefined;
		}
		if (session.expiresAt <= iso(this.ctx.now())) {
			await this.ctx.store.delete("sessions", session.id);
			return undefined;
		}
		const member = await this.ctx.store.get("members", session.memberId);
		return member ? { session, member } : undefined;
	}

	async destroy(token: string | undefined): Promise<void> {
		if (token) {
			await this.ctx.store.delete("sessions", sha256(token));
		}
	}

	async destroyForMember(memberId: string): Promise<void> {
		await this.ctx.store.deleteMany("sessions", {
			where: [{ field: "memberId", op: "eq", value: memberId }],
		});
	}
}
