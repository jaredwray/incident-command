import { COMPONENT_STATUS_LABELS } from "@/lib/domain/status";
import { formatUptime, type UptimeWindow } from "@/lib/domain/uptime";
import { formatMonthRange } from "@/lib/format";
import type { ComponentGroupView, ComponentView } from "@/lib/services/status";
import { StatusIcon } from "../icons";
import { STATUS_TEXT } from "./badges";
import { MOBILE_DAYS, UptimeBars } from "./uptime-bars";

function ComponentRow({ component }: { component: ComponentView }) {
	return (
		<li className="px-5 py-4">
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-2">
					<span className={STATUS_TEXT[component.status]}>
						<StatusIcon status={component.status} className="size-4" />
					</span>
					<span className="truncate font-medium" title={component.description}>
						{component.name}
					</span>
				</div>
				<span
					className={`shrink-0 text-sm ${component.status === "operational" ? "text-muted" : STATUS_TEXT[component.status]}`}
				>
					{component.status === "operational"
						? `${formatUptime(component.uptime)} uptime`
						: COMPONENT_STATUS_LABELS[component.status]}
				</span>
			</div>
			{component.description && (
				<p className="mt-0.5 pl-6 text-sm text-muted">
					{component.description}
				</p>
			)}
			<div className="mt-3">
				<UptimeBars days={component.days} />
			</div>
		</li>
	);
}

export function SystemStatus({
	groups,
	window,
}: {
	groups: ComponentGroupView[];
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
					No components have been added yet.
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
								{group.components.map((component) => (
									<ComponentRow key={component.id} component={component} />
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
