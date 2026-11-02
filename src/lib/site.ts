import { getApp } from "./app";
import type { Settings } from "./domain/types";

/** Settings used when the app cannot start (e.g. the database is unreachable at boot). */
export function fallbackSettings(): Settings {
	return {
		id: "settings",
		siteName: process.env.SITE_NAME || "Status",
		description: "",
		theme: "default",
		allowSubscriptions: false,
		uptimeDays: 90,
		updatedAt: new Date(0).toISOString(),
	};
}

/** Loads settings for layout chrome, never throwing so error pages can still render. */
export async function loadSiteSettings(): Promise<Settings> {
	try {
		const { services } = await getApp();
		return await services.settings.get();
	} catch {
		return fallbackSettings();
	}
}
