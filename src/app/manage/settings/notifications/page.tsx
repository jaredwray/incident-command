import type { Metadata } from "next";
import { NotificationChannelCard } from "@/components/manage/notification-channel";
import { SettingsTabs } from "@/components/manage/settings-tabs";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { requireMember } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsSettingsPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, actor, services, app } = await requireMember("admin");
	const [settings, channels] = await Promise.all([
		services.settings.get(),
		services.notificationSettings.list(actor),
	]);
	const canStoreSecrets = services.notificationSettings.canStoreSecrets;
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="settings"
			title="Settings"
			flash={flash}
			health={app.store.health}
		>
			<SettingsTabs active="notifications" />
			<p className="text-sm text-muted">
				Subscribers get notifications through{" "}
				<a
					href="https://airhorn.org"
					className="underline hover:text-fg"
					rel="noreferrer"
					target="_blank"
				>
					airhorn
				</a>
				. Each channel can have more than one provider. With active/passive, the
				first provider sends and the next provider is a backup. With load
				balanced, the providers send in turn.
			</p>
			{!canStoreSecrets && (
				<p
					role="alert"
					className="rounded-lg border border-degraded/40 bg-degraded/10 px-4 py-3 text-sm"
				>
					ENCRYPTION_KEY is not set, so this server cannot save provider
					credentials. Set ENCRYPTION_KEY to a long random value (for example
					the output of <code>openssl rand -base64 32</code>) in the secrets of
					your platform, then restart the server.
				</p>
			)}
			{channels.map((channel) => (
				<NotificationChannelCard
					key={channel.id}
					channel={channel}
					canStoreSecrets={canStoreSecrets}
				/>
			))}
		</ManageShell>
	);
}
