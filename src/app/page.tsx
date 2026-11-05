import Link from "next/link";
import { OverallBanner } from "@/components/status/banner";
import { IncidentCard } from "@/components/status/incident-card";
import { PublicPage } from "@/components/status/page-shell";
import { IncidentList } from "@/components/status/recent-incidents";
import { SystemStatus } from "@/components/status/system-status";
import { getApp } from "@/lib/app";
import { RECENT_DAYS } from "@/lib/services/status";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
	const { services } = await getApp();
	const [summary, canSubscribe] = await Promise.all([
		services.status.summary(),
		services.subscribers.canSubscribe(),
	]);
	const active = [...summary.activeIncidents, ...summary.activeMaintenance];
	return (
		<PublicPage settings={summary.settings} canSubscribe={canSubscribe}>
			<OverallBanner status={summary.overall} />
			{summary.settings.description && (
				<p className="text-muted">{summary.settings.description}</p>
			)}

			{active.length > 0 && (
				<section aria-label="Active incidents" className="space-y-4">
					{active.map((incident) => (
						<IncidentCard
							key={incident.id}
							incident={incident}
							services={summary.services}
						/>
					))}
				</section>
			)}

			{summary.upcomingMaintenance.length > 0 && (
				<section className="space-y-4">
					<h2 className="font-semibold">Upcoming maintenance</h2>
					{summary.upcomingMaintenance.map((incident) => (
						<IncidentCard
							key={incident.id}
							incident={incident}
							services={summary.services}
						/>
					))}
				</section>
			)}

			<SystemStatus groups={summary.groups} window={summary.window} />

			<section>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="font-semibold">Recent incidents</h2>
					<Link href="/history" className="text-sm text-muted hover:text-fg">
						View history →
					</Link>
				</div>
				<IncidentList
					incidents={summary.recentIncidents}
					empty={`No incidents reported in the last ${RECENT_DAYS} days.`}
				/>
			</section>
		</PublicPage>
	);
}
