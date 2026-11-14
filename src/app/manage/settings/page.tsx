import type { Metadata } from "next";
import { SettingsTabs } from "@/components/manage/settings-tabs";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import {
	buttonClass,
	Card,
	Checkbox,
	Field,
	inputClass,
} from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireMember } from "@/lib/auth";
import { updateGeneralSettingsAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, services, app } = await requireMember("admin");
	const settings = await services.settings.get();
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="settings"
			title="Settings"
			flash={flash}
			health={app.store.health}
		>
			<SettingsTabs active="general" />
			<form action={updateGeneralSettingsAction} className="space-y-6">
				<Card title="Status page">
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Name" htmlFor="siteName">
							<input
								id="siteName"
								name="siteName"
								defaultValue={settings.siteName}
								required
								className={inputClass}
							/>
						</Field>
						<Field
							label="Public URL"
							htmlFor="siteUrl"
							hint="Used for links in notifications."
						>
							<input
								id="siteUrl"
								name="siteUrl"
								type="url"
								defaultValue={settings.siteUrl}
								placeholder="https://status.example.com"
								className={inputClass}
							/>
						</Field>
						<Field label="Support URL" htmlFor="supportUrl">
							<input
								id="supportUrl"
								name="supportUrl"
								type="url"
								defaultValue={settings.supportUrl}
								className={inputClass}
							/>
						</Field>
						<Field label="Uptime window (days)" htmlFor="uptimeDays">
							<input
								id="uptimeDays"
								name="uptimeDays"
								type="number"
								min={7}
								max={365}
								defaultValue={settings.uptimeDays}
								className={inputClass}
							/>
						</Field>
					</div>
					<div className="mt-4 space-y-4">
						<Field
							label="Description"
							htmlFor="description"
							hint="Optional text shown under the status banner."
						>
							<textarea
								id="description"
								name="description"
								rows={2}
								defaultValue={settings.description}
								className={inputClass}
							/>
						</Field>
						<Checkbox
							name="allowSubscriptions"
							label="Allow visitors to subscribe by email"
							defaultChecked={settings.allowSubscriptions}
						/>
					</div>
				</Card>
				<SubmitButton className={buttonClass.primary}>
					Save settings
				</SubmitButton>
			</form>
		</ManageShell>
	);
}
