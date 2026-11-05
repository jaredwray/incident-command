import { OVERALL_STATUS_COPY } from "@/lib/domain/status";
import type { ServiceStatus } from "@/lib/domain/types";
import { StatusIcon } from "../icons";
import { STATUS_BG, STATUS_TEXT } from "./badges";

export function OverallBanner({ status }: { status: ServiceStatus }) {
	const copy = OVERALL_STATUS_COPY[status];
	return (
		<section
			aria-live="polite"
			className="relative overflow-hidden rounded-card border border-border bg-surface p-6 sm:p-8"
		>
			<div className={`absolute inset-x-0 top-0 h-1 ${STATUS_BG[status]}`} />
			<div className="flex items-center gap-4">
				<span className={`shrink-0 ${STATUS_TEXT[status]}`}>
					<StatusIcon status={status} className="size-10" />
				</span>
				<div>
					<h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
						{copy.title}
					</h1>
					<p className="mt-1 text-muted">{copy.description}</p>
				</div>
			</div>
		</section>
	);
}
