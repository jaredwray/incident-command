import { ForbiddenError, ValidationError } from "@/lib/errors";
import { ADMIN, createTestContext, EDITOR } from "../helpers";

describe("SettingsService", () => {
	it("returns defaults derived from config", async () => {
		const t = createTestContext({
			env: { SITE_NAME: "Acme", SITE_URL: "https://status.acme.dev" },
		});
		await expect(t.services.settings.get()).resolves.toEqual({
			id: "settings",
			siteName: "Acme",
			description: "",
			siteUrl: "https://status.acme.dev",
			theme: "default",
			allowSubscriptions: true,
			uptimeDays: 90,
			updatedAt: "1970-01-01T00:00:00.000Z",
		});
	});

	it("creates, updates and clears settings", async () => {
		const t = createTestContext();
		const first = await t.services.settings.update(ADMIN, {
			siteName: "Acme",
			logoUrl: "https://acme.dev/logo.svg",
			brandColor: "#ff6600",
			customCss: ".x{}",
			theme: "midnight",
			uptimeDays: 30,
			allowSubscriptions: false,
		});
		expect(first).toMatchObject({
			siteName: "Acme",
			brandColor: "#ff6600",
			theme: "midnight",
			uptimeDays: 30,
			allowSubscriptions: false,
		});
		expect(first.updatedAt).toBe("2026-11-02T12:00:00.000Z");
		const second = await t.services.settings.update(ADMIN, {
			logoUrl: "",
			brandColor: "",
			customCss: "",
			faviconUrl: undefined,
		});
		expect(second.logoUrl).toBeUndefined();
		expect(second.brandColor).toBeUndefined();
		expect(second.customCss).toBeUndefined();
		expect(second.siteName).toBe("Acme");
		await expect(t.services.settings.get()).resolves.toEqual(second);
	});

	it("requires admin and validates input", async () => {
		const t = createTestContext();
		await expect(
			t.services.settings.update(EDITOR, { siteName: "x" }),
		).rejects.toBeInstanceOf(ForbiddenError);
		await expect(
			t.services.settings.update(ADMIN, { brandColor: "red" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.settings.update(ADMIN, { logoUrl: "javascript:alert(1)" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.settings.update(ADMIN, { theme: "Bad Theme" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			t.services.settings.update(ADMIN, { uptimeDays: 1 }),
		).rejects.toBeInstanceOf(ValidationError);
	});
});
