import Link from "next/link";
import type { Incident } from "@/lib/domain/types";
import { formatDay } from "@/lib/format";
import { EventStatusBadge } from "./badges";

export function groupByDay(incidents: Incident[]): [string, Incident[]][] {
	const groups = new Map<string, Incident[]>();
	for (const incident of incidents) {
		const key = incident.createdAt.slice(0, 10);
		groups.set(key, [...(groups.get(key) ?? []), incident]);
	}
	return [...groups.entries()];
}

export function IncidentList({
	incidents,
	empty,
}: {
	incidents: Incident[];
	empty: string;
}) {
	if (incidents.length === 0) {
		return (
			<p className="rounded-card border border-dashed border-border px-5 py-6 text-center text-sm text-muted">
				{empty}
			</p>
		);
	}
	return (
		<div className="space-y-6">
			{groupByDay(incidents).map(([day, items]) => (
				<div key={day}>
					<h3 className="mb-2 text-sm font-semibold text-muted">
						{formatDay(day)}
					</h3>
					<ul className="divide-y divide-border rounded-card border border-border bg-surface">
						{items.map((incident) => (
							<li key={incident.id} className="px-5 py-4">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<Link
										href={`/incidents/${incident.id}`}
										className="font-medium hover:underline"
									>
										{incident.title}
									</Link>
									<EventStatusBadge
										kind={incident.kind}
										impact={incident.impact}
										status={incident.status}
									/>
								</div>
								<p className="mt-1 line-clamp-2 text-sm text-muted">
									{incident.updates.at(-1)?.message}
								</p>
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}
