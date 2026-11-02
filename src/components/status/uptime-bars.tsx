import { COMPONENT_STATUS_LABELS } from "@/lib/domain/status";
import { type DayStatus, formatUptime } from "@/lib/domain/uptime";
import { formatDay } from "@/lib/format";
import { STATUS_BG } from "./badges";

/** Days older than this are hidden on small screens. */
export const MOBILE_DAYS = 30;

export function UptimeBars({ days }: { days: DayStatus[] }) {
	return (
		<ol
			className="flex h-8 items-stretch gap-[2px]"
			aria-label="Daily status history"
		>
			{days.map((day, index) => {
				const color = day.status ? STATUS_BG[day.status] : "bg-nodata";
				const label = day.status
					? COMPONENT_STATUS_LABELS[day.status]
					: "No data";
				return (
					<li
						key={day.date}
						aria-label={`${formatDay(day.date)}: ${label}`}
						className={`group relative flex-1 ${index < days.length - MOBILE_DAYS ? "hidden sm:block" : ""}`}
					>
						<div
							className={`h-full rounded-[2px] ${color} transition-opacity group-hover:opacity-70`}
						/>
						<div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border border-border bg-surface p-3 text-left text-xs shadow-lg group-hover:block">
							<p className="font-semibold">{formatDay(day.date)}</p>
							<p className="mt-1 text-muted">
								{label}
								{day.uptime !== null && ` · ${formatUptime(day.uptime)} uptime`}
							</p>
							{day.incidents.length > 0 && (
								<ul className="mt-2 space-y-1 border-t border-border pt-2">
									{day.incidents.map((incident) => (
										<li key={incident.id}>{incident.title}</li>
									))}
								</ul>
							)}
						</div>
					</li>
				);
			})}
		</ol>
	);
}
