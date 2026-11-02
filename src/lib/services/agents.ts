import { createId, createSecret, sha256 } from "../crypto";
import { type CreateAgentInput, createAgentSchema } from "../domain/schemas";
import type { Actor, AgentToken, PublicAgentToken } from "../domain/types";
import { NotFoundError } from "../errors";
import {
	authorRef,
	iso,
	parse,
	requireRole,
	type ServiceContext,
} from "./context";

export const TOKEN_PREFIX = "icmd_";
const LAST_USED_RESOLUTION_MS = 60_000;

export function toPublicAgent(agent: AgentToken): PublicAgentToken {
	const { tokenHash: _tokenHash, ...rest } = agent;
	return rest;
}

export function isAgentActive(agent: AgentToken | PublicAgentToken, now: Date) {
	return (
		!agent.revokedAt &&
		(!agent.expiresAt || new Date(agent.expiresAt).getTime() > now.getTime())
	);
}

/** Manages API tokens that let AI agents use the MCP server. */
export class AgentService {
	private readonly ctx: ServiceContext;

	constructor(ctx: ServiceContext) {
		this.ctx = ctx;
	}

	async list(actor: Actor): Promise<PublicAgentToken[]> {
		requireRole(actor, "admin");
		const agents = await this.ctx.store.find("agent_tokens", {
			sort: [{ field: "createdAt", direction: "desc" }],
		});
		return agents.map(toPublicAgent);
	}

	/** Creates a token. The plaintext token is only ever returned here. */
	async create(
		actor: Actor,
		input: CreateAgentInput,
	): Promise<{ token: string; agent: PublicAgentToken }> {
		requireRole(actor, "admin");
		const data = parse(createAgentSchema, input);
		const now = this.ctx.now();
		const token = `${TOKEN_PREFIX}${createSecret(32)}`;
		const agent: AgentToken = {
			id: createId("agt"),
			name: data.name,
			tokenHash: sha256(token),
			tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 6),
			role: data.role ?? "editor",
			createdBy: authorRef(actor),
			createdAt: iso(now),
		};
		if (data.description) {
			agent.description = data.description;
		}
		if (data.expiresInDays) {
			agent.expiresAt = iso(
				new Date(now.getTime() + data.expiresInDays * 86_400_000),
			);
		}
		await this.ctx.store.insert("agent_tokens", agent);
		return { token, agent: toPublicAgent(agent) };
	}

	async revoke(actor: Actor, id: string): Promise<PublicAgentToken> {
		requireRole(actor, "admin");
		const agent = await this.load(id);
		const next = {
			...agent,
			revokedAt: agent.revokedAt ?? iso(this.ctx.now()),
		};
		await this.ctx.store.update("agent_tokens", next);
		return toPublicAgent(next);
	}

	async delete(actor: Actor, id: string): Promise<void> {
		requireRole(actor, "admin");
		if (!(await this.ctx.store.delete("agent_tokens", id))) {
			throw new NotFoundError("Agent", id);
		}
	}

	/** Resolves a bearer token to an agent actor, or `undefined` if invalid. */
	async authenticate(token: string | undefined): Promise<Actor | undefined> {
		if (!token?.startsWith(TOKEN_PREFIX)) {
			return undefined;
		}
		const [agent] = await this.ctx.store.find("agent_tokens", {
			where: [{ field: "tokenHash", op: "eq", value: sha256(token) }],
			limit: 1,
		});
		const now = this.ctx.now();
		if (!agent || !isAgentActive(agent, now)) {
			return undefined;
		}
		const lastUsed = agent.lastUsedAt
			? new Date(agent.lastUsedAt).getTime()
			: 0;
		if (now.getTime() - lastUsed > LAST_USED_RESOLUTION_MS) {
			await this.ctx.store.update("agent_tokens", {
				...agent,
				lastUsedAt: iso(now),
			});
		}
		return { type: "agent", id: agent.id, name: agent.name, role: agent.role };
	}

	private async load(id: string): Promise<AgentToken> {
		const agent = await this.ctx.store.get("agent_tokens", id);
		if (!agent) {
			throw new NotFoundError("Agent", id);
		}
		return agent;
	}
}
