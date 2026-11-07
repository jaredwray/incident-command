import type { Metadata } from "next";
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
import { THEMES } from "@/lib/theme";
import { updateSettingsAction } from "../actions";

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
			<form action={updateSettingsAction} className="space-y-6">
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
				<Card
					title="Branding"
					description="Pick a theme, then fine-tune it with a brand color, logo and custom CSS."
				>
					<fieldset>
						<legend className="mb-2 text-sm font-medium">Theme</legend>
						<div className="grid gap-3 sm:grid-cols-3">
							{THEMES.map((theme) => (
								<label
									key={theme.id}
									data-theme={theme.id}
									className="cursor-pointer rounded-card border border-border bg-bg p-3 text-fg has-checked:ring-2 has-checked:ring-brand"
								>
									<input
										type="radio"
										name="theme"
										value={theme.id}
										defaultChecked={settings.theme === theme.id}
										className="sr-only"
									/>
									<span className="flex gap-1" aria-hidden>
										<span className="size-4 rounded-full bg-brand" />
										<span className="size-4 rounded-full bg-operational" />
										<span className="size-4 rounded-full bg-degraded" />
										<span className="size-4 rounded-full bg-major" />
									</span>
									<span className="mt-2 block text-sm font-medium">
										{theme.name}
									</span>
									<span className="block text-xs text-muted">
										{theme.description}
									</span>
								</label>
							))}
						</div>
					</fieldset>
					<div className="mt-4 grid gap-4 sm:grid-cols-3">
						<Field
							label="Brand color"
							htmlFor="brandColor"
							hint="Hex, e.g. #4f46e5."
						>
							<input
								id="brandColor"
								name="brandColor"
								defaultValue={settings.brandColor}
								pattern="#[0-9a-fA-F]{6}"
								placeholder="#4f46e5"
								className={inputClass}
							/>
						</Field>
						<Field label="Logo URL" htmlFor="logoUrl">
							<input
								id="logoUrl"
								name="logoUrl"
								type="url"
								defaultValue={settings.logoUrl}
								className={inputClass}
							/>
						</Field>
						<Field label="Favicon URL" htmlFor="faviconUrl">
							<input
								id="faviconUrl"
								name="faviconUrl"
								type="url"
								defaultValue={settings.faviconUrl}
								className={inputClass}
							/>
						</Field>
					</div>
					<div className="mt-4">
						<Field
							label="Custom CSS"
							htmlFor="customCss"
							hint={
								<>
									Override any design token, e.g.{" "}
									<code>
										{
											":root { --ic-radius: 0; --ic-font: 'Inter', sans-serif; }"
										}
									</code>
								</>
							}
						>
							<textarea
								id="customCss"
								name="customCss"
								rows={6}
								defaultValue={settings.customCss}
								className={`${inputClass} font-mono`}
							/>
						</Field>
					</div>
				</Card>
				<SubmitButton className={buttonClass.primary}>
					Save settings
				</SubmitButton>
			</form>
		</ManageShell>
	);
}
