import { SERVICE_STATUS_LABELS } from "@/lib/domain/status";
import { formatUptime, type UptimeWindow } from "@/lib/domain/uptime";
import { formatMonthRange } from "@/lib/format";
import type { ServiceGroupView, ServiceView } from "@/lib/services/status";
import { StatusIcon } from "../icons";
import { STATUS_TEXT } from "./badges";
import { MOBILE_DAYS, UptimeBars } from "./uptime-bars";

function ServiceRow({ service }: { service: ServiceView }) {
	return (
		<li className="px-5 py-4">
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-2">
					<span className={STATUS_TEXT[service.status]}>
						<StatusIcon status={service.status} className="size-4" />
					</span>
					<span className="truncate font-medium" title={service.description}>
						{service.name}
					</span>
				</div>
				<span
					className={`shrink-0 text-sm ${service.status === "operational" ? "text-muted" : STATUS_TEXT[service.status]}`}
				>
					{service.status === "operational"
						? `${formatUptime(service.uptime)} uptime`
						: SERVICE_STATUS_LABELS[service.status]}
				</span>
			</div>
			{service.description && (
				<p className="mt-0.5 pl-6 text-sm text-muted">{service.description}</p>
			)}
			<div className="mt-3">
				<UptimeBars days={service.days} />
			</div>
		</li>
	);
}

export function SystemStatus({
	groups,
	window,
}: {
	groups: ServiceGroupView[];
	window: UptimeWindow;
}) {
	return (
		<section className="rounded-card border border-border bg-surface">
			<header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
				<h2 className="font-semibold">System status</h2>
				<span className="text-sm text-muted">
					{formatMonthRange(window.start, window.end)}
				</span>
			</header>
			{groups.length === 0 ? (
				<p className="px-5 py-8 text-center text-sm text-muted">
					No services have been added yet.
				</p>
			) : (
				<div className="divide-y divide-border">
					{groups.map((group) => (
						<div key={group.name ?? "__ungrouped"}>
							{group.name && (
								<h3 className="flex items-center gap-2 bg-surface-muted px-5 py-2 text-xs font-semibold tracking-wide text-muted uppercase">
									{group.name}
								</h3>
							)}
							<ul className="divide-y divide-border">
								{group.services.map((service) => (
									<ServiceRow key={service.id} service={service} />
								))}
							</ul>
						</div>
					))}
				</div>
			)}
			<footer className="flex justify-between border-t border-border px-5 py-3 text-xs text-muted">
				<span className="hidden sm:inline">{window.days} days ago</span>
				<span className="sm:hidden">
					{Math.min(window.days, MOBILE_DAYS)} days ago
				</span>
				<span>Today</span>
			</footer>
		</section>
	);
}
