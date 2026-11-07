import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/manage/shell";
import { buttonClass, Field, Flash, inputClass } from "@/components/manage/ui";
import { SubmitButton } from "@/components/submit-button";
import { getApp } from "@/lib/app";
import { getMemberContext, returnPath } from "@/lib/auth";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; next?: string }>;
}) {
	const { error, next = "" } = await searchParams;
	const { services } = await getApp();
	if ((await services.members.count()) === 0) {
		redirect("/manage/setup");
	}
	if (await getMemberContext()) {
		redirect(returnPath(next));
	}
	const settings = await services.settings.get();
	return (
		<AuthLayout siteName={settings.siteName} title="Sign in">
			<form action={loginAction} className="space-y-4">
				<Flash error={error} />
				<input type="hidden" name="next" value={next} />
				<Field label="Email" htmlFor="email">
					<input
						id="email"
						name="email"
						type="email"
						autoComplete="email"
						required
						className={inputClass}
					/>
				</Field>
				<Field label="Password" htmlFor="password">
					<input
						id="password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
						className={inputClass}
					/>
				</Field>
				<SubmitButton className={`${buttonClass.primary} w-full`}>
					Sign in
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
