import { EVENT_STATUS_LABELS } from "./domain/status";
import type { Incident, Settings } from "./domain/types";

export function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

/** RSS 2.0 feed of recent incidents and maintenance. */
export function buildRssFeed(
	settings: Settings,
	incidents: Incident[],
	baseUrl: string,
): string {
	const base = baseUrl.replace(/\/+$/, "");
	const items = incidents
		.map((incident) => {
			const latest = incident.updates.at(-1);
			const description = latest
				? `${EVENT_STATUS_LABELS[latest.status]}: ${latest.message}`
				: "";
			return [
				"<item>",
				`<title>${escapeXml(incident.title)}</title>`,
				`<link>${escapeXml(`${base}/incidents/${incident.id}`)}</link>`,
				`<guid isPermaLink="false">${incident.id}</guid>`,
				`<pubDate>${new Date(incident.createdAt).toUTCString()}</pubDate>`,
				`<description>${escapeXml(description)}</description>`,
				"</item>",
			].join("");
		})
		.join("");
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0">',
		"<channel>",
		`<title>${escapeXml(settings.siteName)} status</title>`,
		`<link>${escapeXml(base || "/")}</link>`,
		`<description>${escapeXml(`Incident history for ${settings.siteName}`)}</description>`,
		items,
		"</channel>",
		"</rss>",
	].join("");
}
