"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type App, getApp } from "@/lib/app";
import {
	endSession,
	flash,
	loginPath,
	requireMember,
	returnPath,
	startSession,
} from "@/lib/auth";
import type {
	EventStatus,
	IncidentImpact,
	IncidentKind,
	Role,
	ServiceStatus,
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
import { publicOrigin } from "@/lib/manage/origin";
import { draftPath } from "@/lib/services/drafts";
import { invitePath } from "@/lib/services/members";

/**
 * Runs an operation for a `useActionState` form. An expected application
 * error becomes `{ error }`, so the form can show it.
 */
async function formState<T>(
	operation: () => Promise<T>,
): Promise<T | { error: string }> {
	try {
		return await operation();
	} catch (error) {
		if (isAppError(error)) {
			return { error: error.message };
		}
		throw error;
	}
}

// ---- session ------------------------------------------------------------------

export async function loginAction(form: FormData): Promise<void> {
	const app = await getApp();
	const member = await app.services.members.authenticate({
		email: text(form, "email"),
		password: text(form, "password"),
	});
	const next = text(form, "next");
	if (!member) {
		redirect(flash(loginPath(next), "invalid_credentials"));
	}
	await startSession(app, member.id);
	redirect(returnPath(next));
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
	redirect(flash("/manage", "welcome_admin"));
}

export async function acceptInviteAction(form: FormData): Promise<void> {
	const app = await getApp();
	const token = text(form, "token");
	const member = await attempt(invitePath(token), () =>
		app.services.members.acceptInvite(token, {
			name: text(form, "name"),
			password: text(form, "password"),
		}),
	);
	await startSession(app, member.id);
	redirect(flash("/manage", "welcome_member"));
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
	redirect(flash("/manage/account", "password_updated"));
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
			serviceIds: list(form, "serviceIds"),
			serviceStatus: nonEmpty(form, "serviceStatus") as
				| ServiceStatus
				| undefined,
			scheduledStart: dateTime(form, "scheduledStart"),
			scheduledEnd: dateTime(form, "scheduledEnd"),
			notify: checkbox(form, "notify"),
		}),
	);
	redirect(
		flash(
			`/manage/incidents/${incident.id}`,
			kind === "incident" ? "incident_declared" : "maintenance_scheduled",
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
			serviceStatus: nonEmpty(form, "serviceStatus") as
				| ServiceStatus
				| undefined,
			notify: checkbox(form, "notify"),
		}),
	);
	redirect(flash(`/manage/incidents/${id}`, "update_posted"));
}

export async function editIncidentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	const id = text(form, "id");
	await attempt(`/manage/incidents/${id}`, () =>
		services.incidents.edit(actor, id, {
			title: text(form, "title"),
			impact: nonEmpty(form, "impact") as IncidentImpact | undefined,
			serviceIds: list(form, "serviceIds"),
			scheduledStart: dateTime(form, "scheduledStart"),
			scheduledEnd: dateTime(form, "scheduledEnd"),
		}),
	);
	redirect(flash(`/manage/incidents/${id}`, "incident_saved"));
}

export async function deleteIncidentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/incidents", () =>
		services.incidents.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/incidents", "incident_deleted"));
}

// ---- notification drafts ------------------------------------------------------------

/** The draft fields of the review form. Fields that the form does not show stay empty. */
function draftContent(form: FormData) {
	return {
		title: nonEmpty(form, "title"),
		impact: nonEmpty(form, "impact") as IncidentImpact | undefined,
		serviceIds: list(form, "serviceIds"),
		scheduledStart: dateTime(form, "scheduledStart"),
		scheduledEnd: dateTime(form, "scheduledEnd"),
		status: nonEmpty(form, "status") as EventStatus | undefined,
		message: text(form, "message"),
		serviceStatus: nonEmpty(form, "serviceStatus") as ServiceStatus | undefined,
	};
}

export async function saveDraftAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	const id = text(form, "id");
	await attempt(draftPath(id), () =>
		services.drafts.update(actor, id, draftContent(form)),
	);
	redirect(flash(draftPath(id), "draft_saved"));
}

export async function approveDraftAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	const id = text(form, "id");
	const { incident } = await attempt(draftPath(id), () =>
		services.drafts.approve(actor, id, draftContent(form)),
	);
	redirect(flash(`/manage/incidents/${incident.id}`, "draft_approved"));
}

export async function discardDraftAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	const id = text(form, "id");
	await attempt(draftPath(id), () => services.drafts.discard(actor, id));
	redirect(flash("/manage/drafts", "draft_discarded"));
}

// ---- services -------------------------------------------------------------------

export async function createServiceAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/services", () =>
		services.catalog.create(actor, {
			name: text(form, "name"),
			description: text(form, "description"),
			group: text(form, "group"),
			hidden: checkbox(form, "hidden"),
		}),
	);
	redirect(flash("/manage/services", "service_created"));
}

export async function updateServiceAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/services", () =>
		services.catalog.update(actor, text(form, "id"), {
			name: text(form, "name"),
			description: text(form, "description"),
			group: text(form, "group"),
			order: integer(form, "order"),
			hidden: checkbox(form, "hidden"),
		}),
	);
	redirect(flash("/manage/services", "service_saved"));
}

export async function setServiceStatusAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/services", () =>
		services.catalog.setStatus(
			actor,
			text(form, "id"),
			text(form, "status") as ServiceStatus,
		),
	);
	redirect(flash("/manage/services", "status_updated"));
}

export async function deleteServiceAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("editor");
	await attempt("/manage/services", () =>
		services.catalog.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/services", "service_deleted"));
}

// ---- members ----------------------------------------------------------------------

export interface InviteMemberState {
	url?: string;
	email?: string;
	error?: string;
}

/** Used with `useActionState` so the invite link is shown once and never persisted. */
export async function inviteMemberAction(
	_previous: InviteMemberState,
	form: FormData,
): Promise<InviteMemberState> {
	const { actor, services, app } = await requireMember("admin");
	return formState(async () => {
		const { token, invite } = await services.members.invite(actor, {
			email: text(form, "email"),
			role: text(form, "role") as Role,
		});
		revalidatePath("/manage/members");
		return { url: await inviteUrl(app, token), email: invite.email };
	});
}

/** Makes a new link for an open invite. The previous link stops working. */
export async function renewInviteLinkAction(
	id: string,
): Promise<{ url: string } | { error: string }> {
	const { actor, services, app } = await requireMember("admin");
	return formState(async () => {
		const { token } = await services.members.renewInvite(actor, id);
		return { url: await inviteUrl(app, token) };
	});
}

async function inviteUrl(app: App, token: string): Promise<string> {
	const settings = await app.services.settings.get();
	const origin = await publicOrigin(settings.siteUrl ?? app.config.siteUrl);
	return `${origin}${invitePath(token)}`;
}

export async function revokeInviteAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/members", () =>
		services.members.revokeInvite(actor, text(form, "id")),
	);
	redirect(flash("/manage/members", "invite_revoked"));
}

export async function updateMemberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/members", () =>
		services.members.update(actor, text(form, "id"), {
			role: nonEmpty(form, "role") as Role | undefined,
			password: nonEmpty(form, "password"),
		}),
	);
	redirect(flash("/manage/members", "member_updated"));
}

export async function deleteMemberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/members", () =>
		services.members.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/members", "member_removed"));
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
	return formState(async () => {
		const { token, agent } = await services.agents.create(actor, {
			name: text(form, "name"),
			description: text(form, "description"),
			role: text(form, "role") as Role,
			expiresInDays: integer(form, "expiresInDays"),
		});
		revalidatePath("/manage/agents");
		return { token, name: agent.name };
	});
}

export async function revokeAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/agents", () =>
		services.agents.revoke(actor, text(form, "id")),
	);
	redirect(flash("/manage/agents", "token_revoked"));
}

export async function deleteAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/agents", () =>
		services.agents.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/agents", "token_deleted"));
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
	redirect(flash("/manage/subscribers", "subscriber_added"));
}

export async function deleteSubscriberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMember("admin");
	await attempt("/manage/subscribers", () =>
		services.subscribers.remove(actor, text(form, "id")),
	);
	redirect(flash("/manage/subscribers", "subscriber_removed"));
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
	redirect(flash("/manage/settings", "settings_saved"));
}
