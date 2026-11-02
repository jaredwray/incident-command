import type { CSSProperties } from "react";
import type { Settings } from "./domain/types";

export interface ThemePreset {
	id: string;
	name: string;
	description: string;
}

/**
 * Built-in theme presets. Each maps to a `[data-theme="<id>"]` block in
 * `src/themes/<id>.css`. Add a preset by creating a CSS file, importing it in
 * `src/app/globals.css` and listing it here.
 */
export const THEMES: readonly ThemePreset[] = [
	{
		id: "default",
		name: "Default",
		description: "Clean light theme that follows the system dark mode.",
	},
	{ id: "midnight", name: "Midnight", description: "Deep navy dark theme." },
	{ id: "ocean", name: "Ocean", description: "Cool blues with soft surfaces." },
	{ id: "sunset", name: "Sunset", description: "Warm, friendly tones." },
	{
		id: "mono",
		name: "Mono",
		description: "Minimal black and white with sharp corners.",
	},
];

export function resolveTheme(id: string | undefined): string {
	return THEMES.some((theme) => theme.id === id) ? (id as string) : "default";
}

function channel(hex: string, offset: number): number {
	const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
	return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Picks a readable foreground (black or white) for a `#rrggbb` background. */
export function readableForeground(hex: string): string {
	const luminance =
		0.2126 * channel(hex, 1) +
		0.7152 * channel(hex, 3) +
		0.0722 * channel(hex, 5);
	return luminance > 0.4 ? "#0b0b0f" : "#ffffff";
}

/** CSS custom properties applied to `<html>` for the configured brand color. */
export function brandStyle(
	settings: Pick<Settings, "brandColor">,
): CSSProperties {
	if (!settings.brandColor) {
		return {};
	}
	return {
		"--ic-brand": settings.brandColor,
		"--ic-brand-fg": readableForeground(settings.brandColor),
	} as CSSProperties;
}

/**
 * Makes admin-provided CSS safe to inline in a `<style>` element by escaping
 * `<` so the stylesheet can never close the tag and inject markup.
 */
export function sanitizeCss(css: string | undefined): string {
	return (css ?? "").replaceAll("<", "\\3c ");
}
