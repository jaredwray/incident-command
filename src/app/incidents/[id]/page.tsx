import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventStatusBadge, ImpactBadge } from "@/components/status/badges";
import { affectedNames } from "@/components/status/incident-card";
import { PublicPage } from "@/components/status/page-shell";
import { Timeline } from "@/components/status/timeline";
import { LocalTime } from "@/components/time";
import { getApp } from "@/lib/app";
import { formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Props {
	params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { id } = await params;
	const { services } = await getApp();
	const incident = await services.incidents.find(id);
	return { title: incident?.title ?? "Incident not found" };
}

export default async function IncidentPage({ params }: Props) {
	const { id } = await params;
	const { services } = await getApp();
	const incident = await services.incidents.find(id);
	if (!incident) {
		notFound();
	}
	const [settings, components, canSubscribe] = await Promise.all([
		services.settings.get(),
		services.components.list({ includeHidden: false }),
		services.subscribers.canSubscribe(),
	]);
	const names = affectedNames(incident, components);
	return (
		<PublicPage settings={settings} canSubscribe={canSubscribe}>
			<Link href="/" className="text-sm text-muted hover:text-fg">
				← Back to status
			</Link>
			<article className="space-y-6">
				<header className="space-y-3">
					<p className="text-sm font-medium text-muted">
						{incident.kind === "maintenance"
							? "Scheduled maintenance"
							: "Incident"}
					</p>
					<h1 className="text-2xl font-semibold tracking-tight">
						{incident.title}
					</h1>
					<div className="flex flex-wrap gap-2">
						<EventStatusBadge
							kind={incident.kind}
							impact={incident.impact}
							status={incident.status}
						/>
						{incident.kind === "incident" && (
							<ImpactBadge impact={incident.impact} />
						)}
					</div>
					<dl className="grid gap-x-6 gap-y-1 text-sm text-muted sm:grid-cols-[auto_1fr]">
						{incident.kind === "maintenance" &&
						incident.scheduledStart &&
						incident.scheduledEnd ? (
							<>
								<dt>Window</dt>
								<dd>
									<LocalTime iso={incident.scheduledStart} /> –{" "}
									<LocalTime iso={incident.scheduledEnd} />
								</dd>
							</>
						) : (
							<>
								<dt>Started</dt>
								<dd>
									<LocalTime iso={incident.startedAt} />
								</dd>
							</>
						)}
						{incident.resolvedAt && (
							<>
								<dt>
									{incident.kind === "maintenance" ? "Completed" : "Resolved"}
								</dt>
								<dd>
									<LocalTime iso={incident.resolvedAt} /> (
									{formatDuration(
										new Date(incident.resolvedAt).getTime() -
											new Date(incident.startedAt).getTime(),
									)}
									)
								</dd>
							</>
						)}
						{names.length > 0 && (
							<>
								<dt>Affected</dt>
								<dd>{names.join(", ")}</dd>
							</>
						)}
					</dl>
				</header>
				<section className="rounded-card border border-border bg-surface p-6">
					<h2 className="mb-6 font-semibold">Updates</h2>
					<Timeline incident={incident} />
				</section>
			</article>
		</PublicPage>
	);
}
