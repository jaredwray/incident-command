"use server";

import { redirect } from "next/navigation";
import { getApp } from "@/lib/app";
import { isAppError } from "@/lib/errors";

export async function subscribeAction(formData: FormData): Promise<void> {
	const { services } = await getApp();
	let outcome: string;
	try {
		outcome = await services.subscribers.subscribe({
			email: String(formData.get("email") ?? ""),
		});
	} catch (error) {
		if (!isAppError(error)) {
			throw error;
		}
		redirect(`/subscribe?error=${encodeURIComponent(error.message)}`);
	}
	redirect(`/subscribe?status=${outcome}`);
}

export async function unsubscribeAction(formData: FormData): Promise<void> {
	const { services } = await getApp();
	await services.subscribers.unsubscribe(String(formData.get("token") ?? ""));
	redirect("/subscribe/unsubscribe?done=1");
}
