import type { Metadata } from "next";
import Link from "next/link";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { ButtonLink, Card, EmptyState } from "@/components/manage/ui";
import { EventStatusBadge } from "@/components/status/badges";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { hasRole } from "@/lib/domain/status";
import type { Incident } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incidents" };

function IncidentTable({
	incidents,
	empty,
}: {
	incidents: Incident[];
	empty: string;
}) {
	if (incidents.length === 0) {
		return <EmptyState>{empty}</EmptyState>;
	}
	return (
		<ul className="divide-y divide-border">
			{incidents.map((incident) => (
				<li
					key={incident.id}
					className="flex flex-wrap items-center justify-between gap-2 py-3"
				>
					<div>
						<Link
							href={`/manage/incidents/${incident.id}`}
							className="font-medium hover:underline"
						>
							{incident.title}
						</Link>
						<p className="text-xs text-muted">
							{incident.kind === "maintenance" ? "Maintenance" : "Incident"} ·{" "}
							<LocalTime iso={incident.createdAt} /> · {incident.updates.length}{" "}
							update{incident.updates.length === 1 ? "" : "s"}
						</p>
					</div>
					<EventStatusBadge
						kind={incident.kind}
						impact={incident.impact}
						status={incident.status}
					/>
				</li>
			))}
		</ul>
	);
}

export default async function IncidentsPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, services, app } = await requireMember();
	const [settings, open, closed] = await Promise.all([
		services.settings.get(),
		services.incidents.list({ open: true }),
		services.incidents.list({ open: false, limit: 50 }),
	]);
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="incidents"
			title="Incidents"
			flash={flash}
			health={app.store.health}
			actions={
				hasRole(member.role, "editor") && (
					<div className="flex gap-2">
						<ButtonLink
							href="/manage/incidents/new?kind=maintenance"
							variant="secondary"
						>
							Schedule maintenance
						</ButtonLink>
						<ButtonLink href="/manage/incidents/new">
							Declare incident
						</ButtonLink>
					</div>
				)
			}
		>
			<Card title="Open">
				<IncidentTable
					incidents={open}
					empty="No open incidents or maintenance."
				/>
			</Card>
			<Card title="Resolved" description="The 50 most recent.">
				<IncidentTable incidents={closed} empty="Nothing resolved yet." />
			</Card>
		</ManageShell>
	);
}
