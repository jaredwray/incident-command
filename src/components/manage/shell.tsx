import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/manage/actions";
import { hasRole, ROLE_LABELS } from "@/lib/domain/status";
import type { PublicMember, Role } from "@/lib/domain/types";
import type { StoreHealth } from "@/lib/store/cached";
import { Flash } from "./ui";

export type NavKey =
	| "dashboard"
	| "incidents"
	| "components"
	| "members"
	| "agents"
	| "subscribers"
	| "settings"
	| "account";

export const NAV: { key: NavKey; label: string; href: string; role: Role }[] = [
	{ key: "dashboard", label: "Overview", href: "/manage", role: "viewer" },
	{
		key: "incidents",
		label: "Incidents",
		href: "/manage/incidents",
		role: "viewer",
	},
	{
		key: "components",
		label: "Components",
		href: "/manage/components",
		role: "viewer",
	},
	{ key: "members", label: "Members", href: "/manage/members", role: "admin" },
	{
		key: "agents",
		label: "Agents & MCP",
		href: "/manage/agents",
		role: "admin",
	},
	{
		key: "subscribers",
		label: "Subscribers",
		href: "/manage/subscribers",
		role: "admin",
	},
	{
		key: "settings",
		label: "Settings",
		href: "/manage/settings",
		role: "admin",
	},
	{ key: "account", label: "Account", href: "/manage/account", role: "viewer" },
];

export interface FlashParams {
	notice?: string;
	error?: string;
}

export function ManageShell({
	member,
	siteName,
	active,
	title,
	actions,
	flash,
	health,
	children,
}: {
	member: PublicMember;
	siteName: string;
	active: NavKey;
	title: string;
	actions?: ReactNode;
	flash?: FlashParams;
	health?: StoreHealth;
	children: ReactNode;
}) {
	return (
		<div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
			<aside className="border-b border-border bg-surface lg:min-h-dvh lg:border-r lg:border-b-0">
				<div className="flex items-center justify-between px-5 py-4 lg:block">
					<Link href="/manage" className="block font-semibold tracking-tight">
						{siteName}
					</Link>
					<p className="text-xs text-muted lg:mt-1">Incident command</p>
				</div>
				<nav
					className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:pb-0"
					aria-label="Manage"
				>
					{NAV.filter((item) => hasRole(member.role, item.role)).map((item) => (
						<Link
							key={item.key}
							href={item.href}
							aria-current={item.key === active ? "page" : undefined}
							className={`rounded-lg px-3 py-2 text-sm whitespace-nowrap ${
								item.key === active
									? "bg-surface-muted font-medium text-fg"
									: "text-muted hover:bg-surface-muted hover:text-fg"
							}`}
						>
							{item.label}
						</Link>
					))}
				</nav>
				<div className="hidden border-t border-border px-5 py-4 text-sm lg:mt-6 lg:block">
					<p className="truncate font-medium">{member.name}</p>
					<p className="truncate text-xs text-muted">
						{member.email} · {ROLE_LABELS[member.role]}
					</p>
					<div className="mt-3 flex gap-3 text-xs">
						<Link href="/" className="text-muted hover:text-fg">
							View status page
						</Link>
						<form action={logoutAction}>
							<button type="submit" className="text-muted hover:text-fg">
								Sign out
							</button>
						</form>
					</div>
				</div>
			</aside>
			<main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 lg:px-8">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
					{actions}
				</div>
				{health && !health.online && (
					<p
						role="alert"
						className="rounded-lg border border-degraded/40 bg-degraded/10 px-4 py-3 text-sm"
					>
						The database is unreachable ({health.lastError}). The status page is
						serving cached data and changes cannot be saved until it recovers.
					</p>
				)}
				<Flash notice={flash?.notice} error={flash?.error} />
				{children}
			</main>
		</div>
	);
}

/** Centered card layout used by the login and setup pages. */
export function AuthLayout({
	siteName,
	title,
	children,
}: {
	siteName: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
			<p className="text-sm font-medium text-muted">{siteName}</p>
			<h1 className="mt-1 mb-6 text-2xl font-semibold tracking-tight">
				{title}
			</h1>
			<div className="rounded-card border border-border bg-surface p-6">
				{children}
			</div>
		</main>
	);
}
