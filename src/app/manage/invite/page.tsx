import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout } from "@/components/manage/shell";
import { buttonClass, Field, Flash, inputClass } from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { getApp } from "@/lib/app";
import { ROLE_LABELS } from "@/lib/domain/status";
import { acceptInviteAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accept invite" };

export default async function InvitePage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string; error?: string }>;
}) {
	const { token = "", error } = await searchParams;
	const { services } = await getApp();
	const [settings, invite] = await Promise.all([
		services.settings.get(),
		services.members.findInvite(token),
	]);
	if (!invite) {
		return (
			<AuthLayout siteName={settings.siteName} title="Invite not valid">
				<div className="space-y-4">
					<p className="text-sm text-muted">
						This invite link is not correct, was used before, or expired. Ask an
						admin for a new invite.
					</p>
					<Link
						href="/manage/login"
						className={`${buttonClass.secondary} w-full`}
					>
						Go to sign in
					</Link>
				</div>
			</AuthLayout>
		);
	}
	return (
		<AuthLayout siteName={settings.siteName} title="Create your account">
			<form action={acceptInviteAction} className="space-y-4">
				<p className="text-sm text-muted">
					You are invited to {settings.siteName} with the{" "}
					{ROLE_LABELS[invite.role]} role. Set your name and password.
				</p>
				<Flash error={error} />
				<input type="hidden" name="token" value={token} />
				<Field label="Email" htmlFor="email">
					<input
						id="email"
						type="email"
						value={invite.email}
						autoComplete="username"
						readOnly
						className={`${inputClass} text-muted`}
					/>
				</Field>
				<Field label="Name" htmlFor="name">
					<input
						id="name"
						name="name"
						autoComplete="name"
						required
						className={inputClass}
					/>
				</Field>
				<Field
					label="Password"
					htmlFor="password"
					hint="At least 8 characters."
				>
					<input
						id="password"
						name="password"
						type="password"
						autoComplete="new-password"
						minLength={8}
						required
						className={inputClass}
					/>
				</Field>
				<SubmitButton className={`${buttonClass.primary} w-full`}>
					Create account
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
