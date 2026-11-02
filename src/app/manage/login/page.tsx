import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/manage/shell";
import { buttonClass, Field, Flash, inputClass } from "@/components/manage/ui";
import { getApp } from "@/lib/app";
import { getMemberContext } from "@/lib/auth";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { error } = await searchParams;
	const { services } = await getApp();
	if ((await services.members.count()) === 0) {
		redirect("/manage/setup");
	}
	if (await getMemberContext()) {
		redirect("/manage");
	}
	const settings = await services.settings.get();
	return (
		<AuthLayout siteName={settings.siteName} title="Sign in">
			<form action={loginAction} className="space-y-4">
				<Flash error={error} />
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
				<button type="submit" className={`${buttonClass.primary} w-full`}>
					Sign in
				</button>
			</form>
		</AuthLayout>
	);
}
