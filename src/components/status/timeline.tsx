import { EVENT_STATUS_LABELS } from "@/lib/domain/status";
import type { Incident } from "@/lib/domain/types";
import { LocalTime } from "../time";

/** Incident updates, newest first. */
export function Timeline({
	incident,
	showAuthors = false,
}: {
	incident: Incident;
	showAuthors?: boolean;
}) {
	const updates = [...incident.updates].reverse();
	return (
		<ol className="relative space-y-6 border-l border-border pl-6">
			{updates.map((update) => (
				<li key={update.id} className="relative">
					<span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full border-2 border-surface bg-brand" />
					<p className="text-sm font-semibold">
						{EVENT_STATUS_LABELS[update.status]}
					</p>
					<p className="mt-1 whitespace-pre-wrap">{update.message}</p>
					<p className="mt-1 text-xs text-muted">
						<LocalTime iso={update.createdAt} />
						{showAuthors && ` · ${update.author.name} (${update.author.type})`}
					</p>
				</li>
			))}
		</ol>
	);
}
