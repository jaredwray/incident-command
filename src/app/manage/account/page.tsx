import type { Metadata } from "next";
import { type FlashParams, ManageShell } from "@/components/manage/shell";
import { buttonClass, Card, Field, inputClass } from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireMember } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/domain/status";
import { changePasswordAction, logoutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({
	searchParams,
}: {
	searchParams: Promise<FlashParams>;
}) {
	const flash = await searchParams;
	const { member, services, app } = await requireMember();
	const settings = await services.settings.get();
	return (
		<ManageShell
			member={member}
			siteName={settings.siteName}
			active="account"
			title="Account"
			flash={flash}
			health={app.store.health}
		>
			<Card title="Profile">
				<dl className="grid gap-2 text-sm sm:grid-cols-[120px_1fr]">
					<dt className="text-muted">Name</dt>
					<dd>{member.name}</dd>
					<dt className="text-muted">Email</dt>
					<dd>{member.email}</dd>
					<dt className="text-muted">Role</dt>
					<dd>{ROLE_LABELS[member.role]}</dd>
				</dl>
			</Card>
			<Card title="Change password">
				<form action={changePasswordAction} className="max-w-sm space-y-4">
					<Field label="Current password" htmlFor="currentPassword">
						<input
							id="currentPassword"
							name="currentPassword"
							type="password"
							autoComplete="current-password"
							required
							className={inputClass}
						/>
					</Field>
					<Field
						label="New password"
						htmlFor="newPassword"
						hint="At least 8 characters."
					>
						<input
							id="newPassword"
							name="newPassword"
							type="password"
							autoComplete="new-password"
							minLength={8}
							required
							className={inputClass}
						/>
					</Field>
					<SubmitButton className={buttonClass.primary}>
						Update password
					</SubmitButton>
				</form>
			</Card>
			<form action={logoutAction}>
				<SubmitButton className={buttonClass.secondary}>Sign out</SubmitButton>
			</form>
		</ManageShell>
	);
}
