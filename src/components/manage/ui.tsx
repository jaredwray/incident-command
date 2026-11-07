import Link from "next/link";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDownIcon } from "@/components/icons";

export const inputClass =
	"w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-brand focus:outline-none";

/*
 * The select has no `appearance` utility on purpose. `src/app/globals.css`
 * removes the browser chrome and styles the open picker for every select.
 */
const selectClass =
	"peer col-start-1 row-start-1 w-full cursor-pointer truncate rounded-lg border border-border bg-bg py-2 pr-9 pl-3 text-sm text-fg transition-colors hover:border-muted/60 focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
	primary:
		"inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50",
	secondary:
		"inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-50",
	danger:
		"inline-flex items-center justify-center gap-2 rounded-lg border border-major/40 px-3 py-1.5 text-sm font-medium text-major hover:bg-major/10 disabled:opacity-50",
	ghost:
		"inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-muted hover:text-fg",
} as const;

export function Card({
	title,
	description,
	actions,
	children,
}: {
	title?: string;
	description?: string;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="rounded-card border border-border bg-surface">
			{(title || actions) && (
				<header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
					<div>
						{title && <h2 className="font-semibold">{title}</h2>}
						{description && (
							<p className="mt-0.5 text-sm text-muted">{description}</p>
						)}
					</div>
					{actions}
				</header>
			)}
			<div className="p-5">{children}</div>
		</section>
	);
}

export function Field({
	label,
	htmlFor,
	hint,
	children,
}: {
	label: string;
	htmlFor: string;
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<label htmlFor={htmlFor} className="block text-sm font-medium">
				{label}
			</label>
			{children}
			{hint && <p className="text-xs text-muted">{hint}</p>}
		</div>
	);
}

/**
 * A themed native select. The chevron follows the theme and the options keep
 * the keyboard and form behavior of the browser.
 */
export function Select({
	children,
	...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<span className="grid grid-cols-1">
			<select {...props} className={selectClass}>
				{children}
			</select>
			<ChevronDownIcon className="pointer-events-none col-start-1 row-start-1 mr-3 size-4 self-center justify-self-end text-muted transition-colors peer-hover:text-fg peer-focus:text-brand peer-disabled:opacity-50" />
		</span>
	);
}

export function Checkbox({
	name,
	label,
	defaultChecked,
}: {
	name: string;
	label: string;
	defaultChecked?: boolean;
}) {
	return (
		<label className="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				name={name}
				defaultChecked={defaultChecked}
				className="size-4 accent-brand"
			/>
			{label}
		</label>
	);
}

export function Flash({ notice, error }: { notice?: string; error?: string }) {
	return (
		<>
			{notice && (
				<p
					role="status"
					className="rounded-lg border border-operational/40 bg-operational/10 px-4 py-3 text-sm"
				>
					{notice}
				</p>
			)}
			{error && (
				<p
					role="alert"
					className="rounded-lg border border-major/40 bg-major/10 px-4 py-3 text-sm text-major"
				>
					{error}
				</p>
			)}
		</>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
			{children}
		</p>
	);
}

export function ButtonLink({
	href,
	children,
	variant = "primary",
}: {
	href: string;
	children: ReactNode;
	variant?: keyof typeof buttonClass;
}) {
	return (
		<Link href={href} className={buttonClass[variant]}>
			{children}
		</Link>
	);
}
