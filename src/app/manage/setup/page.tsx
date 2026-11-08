import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/manage/shell";
import { buttonClass, Field, Flash, inputClass } from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { getApp } from "@/lib/app";
import { resolveFlash } from "@/lib/flash";
import { setupAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { error } = resolveFlash(await searchParams);
	const { services, config } = await getApp();
	if ((await services.members.count()) > 0) {
		redirect("/manage/login");
	}
	const settings = await services.settings.get();
	return (
		<AuthLayout siteName={settings.siteName} title="Create the first admin">
			<form action={setupAction} className="space-y-4">
				<p className="text-sm text-muted">
					This account can invite members, create agent tokens and change
					settings.
				</p>
				<Flash error={error} />
				<Field label="Name" htmlFor="name">
					<input id="name" name="name" required className={inputClass} />
				</Field>
				<Field label="Email" htmlFor="email">
					<input
						id="email"
						name="email"
						type="email"
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
						minLength={8}
						required
						className={inputClass}
					/>
				</Field>
				{config.setupToken && (
					<Field
						label="Setup token"
						htmlFor="token"
						hint="The SETUP_TOKEN configured for this deployment."
					>
						<input
							id="token"
							name="token"
							type="password"
							required
							className={inputClass}
						/>
					</Field>
				)}
				<SubmitButton className={`${buttonClass.primary} w-full`}>
					Create admin
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
