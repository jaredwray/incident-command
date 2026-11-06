import type { Metadata } from "next";
import Link from "next/link";
import { NoticeCard } from "@/components/status/notice";
import { PublicPage } from "@/components/status/page-shell";
import { SubmitButton } from "@/components/submit-button";
import { getApp } from "@/lib/app";
import { unsubscribeAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe" };

export default async function UnsubscribePage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string; done?: string }>;
}) {
	const { token, done } = await searchParams;
	const { services } = await getApp();
	const settings = await services.settings.get();
	return (
		<PublicPage settings={settings} canSubscribe={false}>
			{done ? (
				<NoticeCard title="You've been unsubscribed">
					<p>You will no longer receive {settings.siteName} updates.</p>
				</NoticeCard>
			) : (
				<NoticeCard title="Unsubscribe from updates">
					<p>
						Stop receiving incident and maintenance emails from{" "}
						{settings.siteName}.
					</p>
					<form action={unsubscribeAction}>
						<input type="hidden" name="token" value={token ?? ""} />
						<SubmitButton className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50">
							Unsubscribe
						</SubmitButton>
					</form>
				</NoticeCard>
			)}
			<Link href="/" className="text-sm text-muted hover:text-fg">
				← Back to status
			</Link>
		</PublicPage>
	);
}
