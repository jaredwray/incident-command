import type { ReactNode } from "react";

export function NoticeCard({
	title,
	children,
}: {
	title: string;
	children?: ReactNode;
}) {
	return (
		<section className="rounded-card border border-border bg-surface p-6 sm:p-8">
			<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
			{children && <div className="mt-2 space-y-4 text-muted">{children}</div>}
		</section>
	);
}
