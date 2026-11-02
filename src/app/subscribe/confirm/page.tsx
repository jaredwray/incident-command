import type { Metadata } from "next";
import Link from "next/link";
import { NoticeCard } from "@/components/status/notice";
import { PublicPage } from "@/components/status/page-shell";
import { getApp } from "@/lib/app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm subscription" };

export default async function ConfirmPage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string }>;
}) {
	const { token } = await searchParams;
	const { services } = await getApp();
	const [settings, subscriber] = await Promise.all([
		services.settings.get(),
		services.subscribers.confirm(token ?? ""),
	]);
	return (
		<PublicPage settings={settings} canSubscribe={false}>
			{subscriber ? (
				<NoticeCard title="You're subscribed">
					<p>
						{subscriber.target} will now receive {settings.siteName} updates.
					</p>
				</NoticeCard>
			) : (
				<NoticeCard title="This link is invalid">
					<p>
						The confirmation link is invalid or has already been used to
						unsubscribe.
					</p>
				</NoticeCard>
			)}
			<Link href="/" className="text-sm text-muted hover:text-fg">
				← Back to status
			</Link>
		</PublicPage>
	);
}
