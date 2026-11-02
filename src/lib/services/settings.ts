import {
	type UpdateSettingsInput,
	updateSettingsSchema,
} from "../domain/schemas";
import type { Actor, Settings } from "../domain/types";
import { iso, parse, requireRole, type ServiceContext } from "./context";

export const SETTINGS_ID = "settings";

export class SettingsService {
	private readonly ctx: ServiceContext;

	constructor(ctx: ServiceContext) {
		this.ctx = ctx;
	}

	defaults(): Settings {
		return {
			id: SETTINGS_ID,
			siteName: this.ctx.config.siteName,
			description: "",
			siteUrl: this.ctx.config.siteUrl,
			theme: "default",
			allowSubscriptions: true,
			uptimeDays: 90,
			updatedAt: new Date(0).toISOString(),
		};
	}

	async get(): Promise<Settings> {
		const stored = await this.ctx.store.get("settings", SETTINGS_ID);
		return { ...this.defaults(), ...stored };
	}

	async update(actor: Actor, input: UpdateSettingsInput): Promise<Settings> {
		requireRole(actor, "admin");
		const patch = parse(updateSettingsSchema, input);
		const current = await this.ctx.store.get("settings", SETTINGS_ID, {
			consistent: true,
		});
		const next: Record<string, unknown> = {
			...this.defaults(),
			...current,
			updatedAt: iso(this.ctx.now()),
		};
		for (const [key, value] of Object.entries(patch)) {
			if (value === null) {
				delete next[key];
			} else if (value !== undefined) {
				next[key] = value;
			}
		}
		const settings = next as unknown as Settings;
		if (current) {
			await this.ctx.store.update("settings", settings);
		} else {
			await this.ctx.store.insert("settings", settings);
		}
		return settings;
	}
}
