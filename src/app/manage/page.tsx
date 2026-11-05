import type { Metadata } from "next";
import Link from "next/link";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { ButtonLink, Card, EmptyState } from "@/components/manage/ui";
import { EventStatusBadge, StatusBadge } from "@/components/status/badges";
import { LocalTime } from "@/components/time";
import { requireMember } from "@/lib/auth";
import { hasRole, OVERALL_STATUS_COPY } from "@/lib/domain/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, services, app } = await requireMember();
	const summary = await services.status.summary();
	const open = [
		...summary.activeIncidents,
		...summary.activeMaintenance,
		...summary.upcomingMaintenance,
	];
	const canEdit = hasRole(member.role, "editor");
	const affected = summary.services.filter(
		(service) => service.status !== "operational",
	);
	return (
		<ManageShell
			member={member}
			siteName={summary.settings.siteName}
			active="dashboard"
			title="Overview"
			flash={flash}
			health={app.store.health}
			actions={
				canEdit && (
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
			<div className="grid gap-4 sm:grid-cols-3">
				<Card>
					<p className="text-sm text-muted">Current status</p>
					<div className="mt-2">
						<StatusBadge status={summary.overall} />
					</div>
					<p className="mt-2 text-sm">
						{OVERALL_STATUS_COPY[summary.overall].title}
					</p>
				</Card>
				<Card>
					<p className="text-sm text-muted">Open incidents</p>
					<p className="mt-2 text-3xl font-semibold">
						{summary.activeIncidents.length}
					</p>
				</Card>
				<Card>
					<p className="text-sm text-muted">Services affected</p>
					<p className="mt-2 text-3xl font-semibold">
						{affected.length}
						<span className="text-base font-normal text-muted">
							{" "}
							/ {summary.services.length}
						</span>
					</p>
				</Card>
			</div>
			<Card title="Open incidents and maintenance">
				{open.length === 0 ? (
					<EmptyState>Nothing open. All quiet.</EmptyState>
				) : (
					<ul className="divide-y divide-border">
						{open.map((incident) => (
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
										Updated <LocalTime iso={incident.updatedAt} />
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
				)}
			</Card>
		</ManageShell>
	);
}
