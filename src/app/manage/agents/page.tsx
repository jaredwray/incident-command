import type { Metadata } from "next";
import { ConfirmButton } from "@/components/manage/confirm-button";
import { CreateAgentForm } from "@/components/manage/create-agent-form";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { buttonClass, Card, EmptyState } from "@/components/manage/ui";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/domain/status";
import { publicOrigin } from "@/lib/manage/origin";
import { isAgentActive } from "@/lib/services/agents";
import {
	createAgentAction,
	deleteAgentAction,
	revokeAgentAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agents & MCP" };

export default async function AgentsPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, actor, services, app } = await requireMember("admin");
	const [settings, agents] = await Promise.all([
		services.settings.get(),
		services.agents.list(actor),
	]);
	const endpoint = `${await publicOrigin(settings.siteUrl ?? app.config.siteUrl)}/api/mcp`;
	const now = new Date();
	const claudeCommand = `claude mcp add --transport http incident-command ${endpoint} --header "Authorization: Bearer <token>"`;
	const jsonConfig = JSON.stringify(
		{
			mcpServers: {
				"incident-command": {
					type: "http",
					url: endpoint,
					headers: { Authorization: "Bearer <token>" },
				},
			},
		},
		null,
		2,
	);
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="agents"
			title="Agents & MCP"
			flash={flash}
			health={app.store.health}
		>
			<Card
				title="Connect an agent"
				description="Agents use the MCP server to manage incidents, components and more."
			>
				<div className="space-y-3 text-sm">
					<p>
						MCP endpoint (Streamable HTTP):{" "}
						<code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
							{endpoint}
						</code>
					</p>
					<p className="text-muted">Claude Code:</p>
					<pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-xs">
						{claudeCommand}
					</pre>
					<p className="text-muted">Other MCP clients:</p>
					<pre className="overflow-x-auto rounded-lg bg-surface-muted p-3 font-mono text-xs">
						{jsonConfig}
					</pre>
				</div>
			</Card>
			<Card title="Create a token">
				<CreateAgentForm action={createAgentAction} />
			</Card>
			<Card title="Tokens">
				{agents.length === 0 ? (
					<EmptyState>No agent tokens yet.</EmptyState>
				) : (
					<ul className="divide-y divide-border">
						{agents.map((agent) => {
							const active = isAgentActive(agent, now);
							return (
								<li
									key={agent.id}
									className="flex flex-wrap items-center justify-between gap-3 py-3"
								>
									<div>
										<p className="font-medium">
											{agent.name}{" "}
											<span
												className={`ml-1 text-xs ${active ? "text-operational" : "text-major"}`}
											>
												{active
													? "active"
													: agent.revokedAt
														? "revoked"
														: "expired"}
											</span>
										</p>
										<p className="text-xs text-muted">
											<code className="font-mono">{agent.tokenPrefix}…</code> ·{" "}
											{ROLE_LABELS[agent.role]} ·{" "}
											{agent.lastUsedAt ? (
												<>
													Last used <LocalTime iso={agent.lastUsedAt} />
												</>
											) : (
												"Never used"
											)}
											{agent.expiresAt && (
												<>
													{" "}
													· Expires <LocalTime iso={agent.expiresAt} />
												</>
											)}
										</p>
										{agent.description && (
											<p className="text-sm text-muted">{agent.description}</p>
										)}
									</div>
									<div className="flex gap-2">
										{active && (
											<form action={revokeAgentAction}>
												<input type="hidden" name="id" value={agent.id} />
												<ConfirmButton
													message={`Revoke ${agent.name}? It will stop working immediately.`}
													className={buttonClass.secondary}
												>
													Revoke
												</ConfirmButton>
											</form>
										)}
										<form action={deleteAgentAction}>
											<input type="hidden" name="id" value={agent.id} />
											<ConfirmButton message={`Delete ${agent.name}?`}>
												Delete
											</ConfirmButton>
										</form>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</Card>
		</ManageShell>
	);
}
