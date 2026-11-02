"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getApp } from "@/lib/app";
import { endSession, flash, requireMember, startSession } from "@/lib/auth";
import type {
	ComponentStatus,
	EventStatus,
	IncidentImpact,
	IncidentKind,
	Role,
} from "@/lib/domain/types";
import { isAppError } from "@/lib/errors";
import {
	attempt,
	checkbox,
	dateTime,
	integer,
	list,
	nonEmpty,
	optionalText,
	text,
} from "@/lib/manage/forms";

// ---- session ------------------------------------------------------------------

export async function loginAction(form: FormData): Promise<void> {
	const app = await getApp();
	const member = await app.services.members.authenticate({
		email: text(form, "email"),
		password: text(form, "password"),
	});
	if (!member) {
		redirect(flash("/manage/login", "error", "Invalid email or password"));
	}
	await startSession(app, member.id);
	redirect("/manage");
}

export async function logoutAction(): Promise<void> {
	await endSession(await getApp());
	redirect("/manage/login");
}

export async function setupAction(form: FormData): Promise<void> {
	const app = await getApp();
	const member = await attempt("/manage/setup", () =>
		app.services.members.setup(
			{
				name: text(form, "name"),
				email: text(form, "email"),
				password: text(form, "password"),
			},
			nonEmpty(form, "token"),
		),
	);
	await startSession(app, member.id);
	redirect(flash("/manage", "notice", "Welcome! Your admin account is ready."));
}

export async function changePasswordAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember();
	await attempt("/manage/account", () =>
		services.members.changePassword(
			actor,
			text(form, "currentPassword"),
			text(form, "newPassword"),
		),
	);
	redirect(flash("/manage/account", "notice", "Password updated"));
}

// ---- incidents ------------------------------------------------------------------

export async function createIncidentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	const kind = (text(form, "kind") || "incident") as IncidentKind;
	const incident = await attempt(`/manage/incidents/new?kind=${kind}`, () =>
		services.incidents.create(actor, {
			kind,
			title: text(form, "title"),
			message: text(form, "message"),
			impact: nonEmpty(form, "impact") as IncidentImpact | undefined,
			status: nonEmpty(form, "status") as EventStatus | undefined,
			componentIds: list(form, "componentIds"),
			componentStatus: nonEmpty(form, "componentStatus") as
				| ComponentStatus
				| undefined,
			scheduledStart: dateTime(form, "scheduledStart"),
			scheduledEnd: dateTime(form, "scheduledEnd"),
			notify: checkbox(form, "notify"),
		}),
	);
	redirect(
		flash(
			`/manage/incidents/${incident.id}`,
			"notice",
			kind === "incident" ? "Incident declared" : "Maintenance scheduled",
		),
	);
}

export async function postIncidentUpdateAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	const id = text(form, "id");
	await attempt(`/manage/incidents/${id}`, () =>
		services.incidents.postUpdate(actor, id, {
			status: nonEmpty(form, "status") as EventStatus | undefined,
			message: text(form, "message"),
			componentStatus: nonEmpty(form, "componentStatus") as
				| ComponentStatus
				| undefined,
			notify: checkbox(form, "notify"),
		}),
	);
	redirect(flash(`/manage/incidents/${id}`, "notice", "Update posted"));
}

export async function editIncidentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	const id = text(form, "id");
	await attempt(`/manage/incidents/${id}`, () =>
		services.incidents.edit(actor, id, {
			title: text(form, "title"),
			impact: nonEmpty(form, "impact") as IncidentImpact | undefined,
			componentIds: list(form, "componentIds"),
			scheduledStart: dateTime(form, "scheduledStart"),
			scheduledEnd: dateTime(form, "scheduledEnd"),
		}),
	);
	redirect(flash(`/manage/incidents/${id}`, "notice", "Incident saved"));
}

export async function deleteIncidentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/incidents", () =>
		services.incidents.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/incidents", "notice", "Incident deleted"));
}

// ---- components -------------------------------------------------------------------

export async function createComponentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/components", () =>
		services.components.create(actor, {
			name: text(form, "name"),
			description: text(form, "description"),
			group: text(form, "group"),
			hidden: checkbox(form, "hidden"),
		}),
	);
	redirect(flash("/manage/components", "notice", "Component created"));
}

export async function updateComponentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/components", () =>
		services.components.update(actor, text(form, "id"), {
			name: text(form, "name"),
			description: text(form, "description"),
			group: text(form, "group"),
			order: integer(form, "order"),
			hidden: checkbox(form, "hidden"),
		}),
	);
	redirect(flash("/manage/components", "notice", "Component saved"));
}

export async function setComponentStatusAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/components", () =>
		services.components.setStatus(
			actor,
			text(form, "id"),
			text(form, "status") as ComponentStatus,
		),
	);
	redirect(flash("/manage/components", "notice", "Status updated"));
}

export async function deleteComponentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/components", () =>
		services.components.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/components", "notice", "Component deleted"));
}

// ---- members ----------------------------------------------------------------------

export async function createMemberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/members", () =>
		services.members.create(actor, {
			name: text(form, "name"),
			email: text(form, "email"),
			role: text(form, "role") as Role,
			password: text(form, "password"),
		}),
	);
	redirect(flash("/manage/members", "notice", "Member added"));
}

export async function updateMemberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/members", () =>
		services.members.update(actor, text(form, "id"), {
			role: nonEmpty(form, "role") as Role | undefined,
			password: nonEmpty(form, "password"),
		}),
	);
	redirect(flash("/manage/members", "notice", "Member updated"));
}

export async function deleteMemberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/members", () =>
		services.members.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/members", "notice", "Member removed"));
}

// ---- agents -----------------------------------------------------------------------

export interface CreateAgentState {
	token?: string;
	name?: string;
	error?: string;
}

/** Used with `useActionState` so the token is shown once and never persisted. */
export async function createAgentAction(
	_previous: CreateAgentState,
	form: FormData,
): Promise<CreateAgentState> {
	const { actor, services } = await requireMember("admin");
	try {
		const { token, agent } = await services.agents.create(actor, {
			name: text(form, "name"),
			description: text(form, "description"),
			role: text(form, "role") as Role,
			expiresInDays: integer(form, "expiresInDays"),
		});
		revalidatePath("/manage/agents");
		return { token, name: agent.name };
	} catch (error) {
		if (isAppError(error)) {
			return { error: error.message };
		}
		throw error;
	}
}

export async function revokeAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/agents", () =>
		services.agents.revoke(actor, text(form, "id")),
	);
	redirect(flash("/manage/agents", "notice", "Token revoked"));
}

export async function deleteAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/agents", () =>
		services.agents.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/agents", "notice", "Token deleted"));
}

// ---- subscribers --------------------------------------------------------------------

export async function addSubscriberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	const target = text(form, "target");
	await attempt("/manage/subscribers", () =>
		text(form, "type") === "email"
			? services.subscribers.addEmail(actor, { email: target })
			: services.subscribers.addWebhook(actor, { url: target }),
	);
	redirect(flash("/manage/subscribers", "notice", "Subscriber added"));
}

export async function deleteSubscriberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/subscribers", () =>
		services.subscribers.remove(actor, text(form, "id")),
	);
	redirect(flash("/manage/subscribers", "notice", "Subscriber removed"));
}

// ---- settings -----------------------------------------------------------------------

export async function updateSettingsAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/settings", () =>
		services.settings.update(actor, {
			siteName: text(form, "siteName"),
			description: text(form, "description"),
			siteUrl: optionalText(form, "siteUrl"),
			logoUrl: optionalText(form, "logoUrl"),
			faviconUrl: optionalText(form, "faviconUrl"),
			supportUrl: optionalText(form, "supportUrl"),
			theme: text(form, "theme"),
			brandColor: optionalText(form, "brandColor"),
			customCss: optionalText(form, "customCss"),
			allowSubscriptions: checkbox(form, "allowSubscriptions"),
			uptimeDays: integer(form, "uptimeDays"),
		}),
	);
	redirect(flash("/manage/settings", "notice", "Settings saved"));
}
