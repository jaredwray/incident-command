import Link from "next/link";
import { EVENT_STATUS_LABELS } from "@/lib/domain/status";
import type { Component, Incident } from "@/lib/domain/types";
import { LocalTime } from "../time";
import { EventStatusBadge, eventColorStatus, STATUS_BG } from "./badges";

export function affectedNames(
	incident: Incident,
	components: Component[],
): string[] {
	return components
		.filter((component) => incident.componentIds.includes(component.id))
		.map((component) => component.name);
}

/** Card for an open incident or maintenance showing its latest update. */
export function IncidentCard({
	incident,
	components,
}: {
	incident: Incident;
	components: Component[];
}) {
	const latest = incident.updates.at(-1);
	const names = affectedNames(incident, components);
	const color = eventColorStatus(
		incident.kind,
		incident.impact,
		incident.status,
	);
	return (
		<article className="relative overflow-hidden rounded-card border border-border bg-surface">
			<div className={`absolute inset-y-0 left-0 w-1 ${STATUS_BG[color]}`} />
			<div className="p-5 pl-6">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<h2 className="font-semibold">
						<Link
							href={`/incidents/${incident.id}`}
							className="hover:underline"
						>
							{incident.title}
						</Link>
					</h2>
					<EventStatusBadge
						kind={incident.kind}
						impact={incident.impact}
						status={incident.status}
					/>
				</div>
				{incident.kind === "maintenance" &&
					incident.scheduledStart &&
					incident.scheduledEnd && (
						<p className="mt-1 text-sm text-muted">
							Scheduled <LocalTime iso={incident.scheduledStart} /> –{" "}
							<LocalTime iso={incident.scheduledEnd} />
						</p>
					)}
				{names.length > 0 && (
					<p className="mt-1 text-sm text-muted">Affects {names.join(", ")}</p>
				)}
				{latest && (
					<div className="mt-4 border-l-2 border-border pl-4">
						<p className="text-sm whitespace-pre-wrap">
							<span className="font-medium">
								{EVENT_STATUS_LABELS[latest.status]}
							</span>{" "}
							— {latest.message}
						</p>
						<p className="mt-1 text-xs text-muted">
							<LocalTime iso={latest.createdAt} />
						</p>
					</div>
				)}
			</div>
		</article>
	);
}
