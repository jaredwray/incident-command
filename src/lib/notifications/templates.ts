import type { AirhornTemplate } from "airhorn";
import { EVENT_STATUS_LABELS } from "../domain/status";
import type {
	Component,
	Incident,
	IncidentUpdate,
	Settings,
	Subscriber,
} from "../domain/types";

export type NotificationEvent =
	| "incident.created"
	| "incident.updated"
	| "incident.resolved"
	| "maintenance.scheduled"
	| "maintenance.updated"
	| "maintenance.completed";

export interface IncidentNotification {
	event: NotificationEvent;
	incident: Incident;
	update: IncidentUpdate;
	settings: Settings;
	components: Component[];
	siteUrl?: string;
}

const EVENT_PREFIX: Record<NotificationEvent, string> = {
	"incident.created": "New incident",
	"incident.updated": "Incident update",
	"incident.resolved": "Resolved",
	"maintenance.scheduled": "Scheduled maintenance",
	"maintenance.updated": "Maintenance update",
	"maintenance.completed": "Maintenance completed",
};

export const EMAIL_TEMPLATE: AirhornTemplate = {
	templateEngine: "ejs",
	subject: "[<%- siteName %>] <%- prefix %>: <%- title %>",
	content: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#111827">
<p style="color:#6b7280;font-size:13px;margin:0 0 4px"><%= siteName %></p>
<h2 style="margin:0 0 8px;font-size:20px"><%= title %></h2>
<p style="margin:0 0 16px;font-size:14px"><strong><%= statusLabel %></strong><% if (components) { %> &middot; Affects <%= components %><% } %></p>
<p style="white-space:pre-wrap;font-size:15px;line-height:1.5;margin:0 0 16px"><%= message %></p>
<% if (incidentUrl) { %><p><a href="<%= incidentUrl %>" style="color:#2563eb">View on the status page</a></p><% } %>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="font-size:12px;color:#6b7280;margin:0">You are receiving this because you subscribed to <%= siteName %> updates.<% if (unsubscribeUrl) { %> <a href="<%= unsubscribeUrl %>" style="color:#6b7280">Unsubscribe</a><% } %></p>
</div>`,
};

export const CONFIRM_TEMPLATE: AirhornTemplate = {
	templateEngine: "ejs",
	subject: "Confirm your subscription to <%- siteName %>",
	content: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#111827">
<h2 style="margin:0 0 12px;font-size:20px">Confirm your subscription</h2>
<p style="font-size:15px;line-height:1.5">Click the link below to receive incident and maintenance updates from <%= siteName %>.</p>
<p><a href="<%= confirmUrl %>" style="color:#2563eb">Confirm subscription</a></p>
<p style="font-size:12px;color:#6b7280">If you did not request this, you can ignore this email.</p>
</div>`,
};

export const WEBHOOK_TEMPLATE: AirhornTemplate = {
	templateEngine: "ejs",
	content: "<%- payload %>",
};

function joinUrl(base: string | undefined, path: string): string | undefined {
	return base ? `${base.replace(/\/+$/, "")}${path}` : undefined;
}

export function siteUrlFor(
	settings: Settings,
	fallback?: string,
): string | undefined {
	return settings.siteUrl || fallback;
}

export function incidentUrl(notification: IncidentNotification) {
	return joinUrl(
		siteUrlFor(notification.settings, notification.siteUrl),
		`/incidents/${notification.incident.id}`,
	);
}

export function unsubscribeUrl(
	subscriber: Subscriber,
	settings: Settings,
	fallback?: string,
) {
	return joinUrl(
		siteUrlFor(settings, fallback),
		`/subscribe/unsubscribe?token=${encodeURIComponent(subscriber.token)}`,
	);
}

export function confirmUrl(
	subscriber: Subscriber,
	settings: Settings,
	fallback?: string,
) {
	return joinUrl(
		siteUrlFor(settings, fallback),
		`/subscribe/confirm?token=${encodeURIComponent(subscriber.token)}`,
	);
}

/** One-line human summary (used as Slack `text` / Discord `content`). */
export function summaryText(notification: IncidentNotification): string {
	const { incident, update, settings, event } = notification;
	const url = incidentUrl(notification);
	const lines = [
		`[${settings.siteName}] ${EVENT_PREFIX[event]}: ${incident.title}`,
		`${EVENT_STATUS_LABELS[update.status]}: ${update.message}`,
	];
	if (url) {
		lines.push(url);
	}
	return lines.join("\n");
}

export function emailData(
	notification: IncidentNotification,
	subscriber: Subscriber,
) {
	return {
		siteName: notification.settings.siteName,
		prefix: EVENT_PREFIX[notification.event],
		title: notification.incident.title,
		statusLabel: EVENT_STATUS_LABELS[notification.update.status],
		message: notification.update.message,
		components: notification.components
			.map((component) => component.name)
			.join(", "),
		incidentUrl: incidentUrl(notification),
		unsubscribeUrl: unsubscribeUrl(
			subscriber,
			notification.settings,
			notification.siteUrl,
		),
	};
}

export function webhookPayload(notification: IncidentNotification) {
	const text = summaryText(notification);
	const { incident } = notification;
	return {
		event: notification.event,
		text,
		content: text,
		incident: {
			id: incident.id,
			kind: incident.kind,
			title: incident.title,
			status: incident.status,
			impact: incident.impact,
			url: incidentUrl(notification),
			components: notification.components.map(({ id, name, status }) => ({
				id,
				name,
				status,
			})),
			startedAt: incident.startedAt,
			resolvedAt: incident.resolvedAt,
			scheduledStart: incident.scheduledStart,
			scheduledEnd: incident.scheduledEnd,
		},
		update: {
			id: notification.update.id,
			status: notification.update.status,
			message: notification.update.message,
			createdAt: notification.update.createdAt,
		},
		page: {
			name: notification.settings.siteName,
			url: siteUrlFor(notification.settings, notification.siteUrl),
		},
		timestamp: new Date().toISOString(),
	};
}
