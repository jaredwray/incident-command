import type { Metadata } from "next";
import Link from "next/link";
import { NoticeCard } from "@/components/status/notice";
import { PublicPage } from "@/components/status/page-shell";
import { getApp } from "@/lib/app";
import { subscribeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subscribe to updates" };

interface Props {
	searchParams: Promise<{ status?: string; error?: string }>;
}

export default async function SubscribePage({ searchParams }: Props) {
	const { status, error } = await searchParams;
	const { services } = await getApp();
	const [settings, canSubscribe] = await Promise.all([
		services.settings.get(),
		services.subscribers.canSubscribe(),
	]);

	let body = (
		<NoticeCard title={`Get ${settings.siteName} updates`}>
			<p>
				We'll email you when we create, update or resolve an incident or
				schedule maintenance.
			</p>
			{error && (
				<p
					role="alert"
					className="rounded-lg border border-major/40 px-3 py-2 text-sm text-major"
				>
					{error}
				</p>
			)}
			<form
				action={subscribeAction}
				className="flex flex-col gap-3 sm:flex-row"
			>
				<label htmlFor="email" className="sr-only">
					Email address
				</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					placeholder="you@example.com"
					className="min-w-0 flex-1 rounded-full border border-border bg-bg px-4 py-2 text-fg"
				/>
				<button
					type="submit"
					className="rounded-full bg-brand px-5 py-2 font-medium text-brand-fg hover:opacity-90"
				>
					Subscribe
				</button>
			</form>
		</NoticeCard>
	);
	if (!canSubscribe) {
		body = (
			<NoticeCard title="Subscriptions are not available">
				<p>This status page does not offer email updates right now.</p>
			</NoticeCard>
		);
	} else if (status === "confirmation_sent") {
		body = (
			<NoticeCard title="Check your inbox">
				<p>
					We sent you a confirmation link. Click it to start receiving updates.
				</p>
			</NoticeCard>
		);
	} else if (status === "already_subscribed") {
		body = (
			<NoticeCard title="You're already subscribed">
				<p>That address already receives updates.</p>
			</NoticeCard>
		);
	}

	return (
		<PublicPage settings={settings} canSubscribe={false}>
			{body}
			<Link href="/" className="text-sm text-muted hover:text-fg">
				← Back to status
			</Link>
		</PublicPage>
	);
}
