import Link from "next/link";
import type { ReactNode } from "react";
import { WatchtowerLogo } from "@/components/watchtower-logo";
import type { Settings } from "@/lib/domain/types";

export function SiteHeader({
	settings,
	canSubscribe,
}: {
	settings: Settings;
	canSubscribe: boolean;
}) {
	return (
		<header className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-4 pt-10 pb-6">
			<Link href="/" className="flex items-center gap-3">
				{settings.logoUrl ? (
					// biome-ignore lint/performance/noImgElement: logos are arbitrary external URLs configured at runtime
					<img
						src={settings.logoUrl}
						alt={settings.siteName}
						className="h-8 w-auto"
					/>
				) : (
					<>
						<WatchtowerLogo />
						<span className="text-lg font-semibold tracking-tight">
							{settings.siteName}
						</span>
					</>
				)}
			</Link>
			<nav className="flex items-center gap-2 text-sm">
				{settings.supportUrl && (
					<a
						href={settings.supportUrl}
						className="rounded-full px-3 py-1.5 text-muted hover:text-fg"
						target="_blank"
						rel="noreferrer"
					>
						Support
					</a>
				)}
				{canSubscribe && (
					<Link
						href="/subscribe"
						className="rounded-full bg-brand px-4 py-1.5 font-medium text-brand-fg hover:opacity-90"
					>
						Subscribe to updates
					</Link>
				)}
			</nav>
		</header>
	);
}

export function SiteFooter() {
	return (
		<footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 pb-10 text-xs text-muted">
			<span>
				Powered by{" "}
				<a
					href="https://github.com/jaredwray/incident-command"
					className="underline-offset-2 hover:underline"
				>
					Incident Command
				</a>
			</span>
			<span className="flex gap-4">
				<Link href="/history" className="hover:text-fg">
					History
				</Link>
				<a href="/api/v1/status" className="hover:text-fg">
					API
				</a>
			</span>
		</footer>
	);
}

/** Layout used by every public page. */
export function PublicPage({
	settings,
	canSubscribe,
	children,
}: {
	settings: Settings;
	canSubscribe: boolean;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-dvh flex-col">
			<SiteHeader settings={settings} canSubscribe={canSubscribe} />
			<main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 pb-16">
				{children}
			</main>
			<SiteFooter />
		</div>
	);
}
