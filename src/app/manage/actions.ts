"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type App, getApp } from "@/lib/app";
import {
	endSession,
	failTwoFactor,
	flash,
	loginPath,
	pendingLogin,
	promoteSession,
	requireMemberForAction,
	returnPath,
	startPendingSession,
	startSession,
	twoFactorPath,
} from "@/lib/auth";
import { createId } from "@/lib/crypto";
import type { MoveDirection } from "@/lib/domain/schemas";
import {
	TWO_FACTOR_ALREADY_ON,
	TWO_FACTOR_SECRET_UNREADABLE,
} from "@/lib/domain/totp";
import type {
	Actor,
	DeliveryStrategy,
	EventStatus,
	IncidentImpact,
	IncidentKind,
	NotificationChannel,
	ProviderType,
	QueueProviderId,
	Role,
	ServiceStatus,
} from "@/lib/domain/types";
import { isAppError } from "@/lib/errors";
import type { FlashCode } from "@/lib/flash";
import {
	attempt,
	checkbox,
	dateTime,
	integer,
	list,
	nonEmpty,
	optionalText,
	prefixed,
	text,
} from "@/lib/manage/forms";
import { publicOrigin } from "@/lib/manage/origin";
import {
	authorizationParams,
	authorizePath,
	publicMcpEndpoint,
} from "@/lib/mcp/oauth";
import { draftPath } from "@/lib/services/drafts";
import { invitePath } from "@/lib/services/members";
import type { BrandAssetChange } from "@/lib/services/settings";

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

/**
 * Opens the portal, or sends the member to the authenticator page.
 * A required setting sends a member with no authenticator to setup first.
 */
async function finishSignIn(
	app: App,
	memberId: string,
	next: string,
	notice?: FlashCode,
): Promise<void> {
	const settings = await app.services.settings.get();
	const status = await app.services.twoFactor.status(
		memberId,
		settings.siteName,
	);
	if (status.enabled) {
		await startPendingSession(app, memberId, "totp");
		redirect(twoFactorPath(next));
	}
	if (settings.requireTwoFactor) {
		if (!status.setup) {
			await app.services.twoFactor.begin(memberId, settings.siteName);
		}
		await startPendingSession(app, memberId, "enroll");
		const path = twoFactorPath(next);
		redirect(notice ? flash(path, notice) : path);
	}
	await startSession(app, memberId);
	redirect(notice ? flash(returnPath(next), notice) : returnPath(next));
}

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
	await finishSignIn(app, member.id, next);
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
	await finishSignIn(app, member.id, "/manage", "welcome_admin");
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
	await finishSignIn(app, member.id, "/manage", "welcome_member");
}

const ACCOUNT = "/manage/account";
const accountAccess = { allowMissingTwoFactor: true } as const;

/** The account page, with a safe return path when the member has one. */
function accountPath(next: string): string {
	const path = returnPath(next);
	return path === "/manage"
		? ACCOUNT
		: `${ACCOUNT}?next=${encodeURIComponent(path)}`;
}

export async function changePasswordAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction(
		"viewer",
		accountAccess,
	);
	await attempt(ACCOUNT, () =>
		services.members.changePassword(
			actor,
			text(form, "currentPassword"),
			text(form, "newPassword"),
		),
	);
	redirect(flash(ACCOUNT, "password_updated"));
}

export async function beginTwoFactorAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction(
		"viewer",
		accountAccess,
	);
	const path = accountPath(text(form, "next"));
	const settings = await services.settings.get();
	await attempt(path, () =>
		services.twoFactor.begin(actor.id, settings.siteName),
	);
	redirect(path);
}

export async function confirmTwoFactorAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction(
		"viewer",
		accountAccess,
	);
	const path = accountPath(text(form, "next"));
	await attempt(path, () =>
		services.twoFactor.confirm(actor.id, text(form, "code")),
	);
	redirect(flash(path, "two_factor_enabled"));
}

export async function acknowledgeRecoveryCodesAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction(
		"viewer",
		accountAccess,
	);
	const path = accountPath(text(form, "next"));
	await services.twoFactor.acknowledge(actor);
	redirect(flash(path, "recovery_codes_saved"));
}

export async function regenerateRecoveryCodesAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction(
		"viewer",
		accountAccess,
	);
	const path = accountPath(text(form, "next"));
	await attempt(path, () =>
		services.twoFactor.regenerate(actor, text(form, "password")),
	);
	redirect(flash(path, "recovery_codes_updated"));
}

export async function disableTwoFactorAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction(
		"viewer",
		accountAccess,
	);
	const path = accountPath(text(form, "next"));
	const settings = await services.settings.get();
	await attempt(path, () =>
		services.twoFactor.disable(
			actor,
			text(form, "password"),
			text(form, "code"),
			settings.requireTwoFactor,
		),
	);
	redirect(flash(path, "two_factor_disabled"));
}

/** Checks an authenticator code or a recovery code, then opens the portal. */
export async function submitTwoFactorAction(form: FormData): Promise<void> {
	const app = await getApp();
	const next = text(form, "next");
	const pending = await pendingLogin(app);
	if (!pending) {
		redirect(loginPath(next));
	}
	const code = text(form, "code");
	try {
		if (pending.session.purpose === "enroll") {
			try {
				await app.services.twoFactor.confirm(pending.member.id, code);
			} catch (error) {
				if (!isAppError(error) || error.message !== TWO_FACTOR_ALREADY_ON) {
					throw error;
				}
				await app.services.twoFactor.verify(pending.member.id, code);
			}
		} else {
			await app.services.twoFactor.verify(pending.member.id, code);
		}
	} catch (error) {
		if (!isAppError(error)) {
			throw error;
		}
		if (error.message === TWO_FACTOR_SECRET_UNREADABLE) {
			redirect(flash(twoFactorPath(next), "two_factor_secret_unreadable"));
		}
		await failTwoFactor(app, next);
	}
	await promoteSession(app);
	if (pending.session.purpose === "enroll") {
		redirect(flash(accountPath(next), "two_factor_enabled"));
	}
	redirect(returnPath(next));
}

// ---- incidents ------------------------------------------------------------------

/**
 * The status of each single service, from the `serviceStatus:<id>` selects.
 * A form with a service picker sends `serviceIds`. In that form, only a
 * selected service keeps its status.
 */
function serviceStatuses(form: FormData) {
	const selected = form.has("serviceIds")
		? list(form, "serviceIds")
		: undefined;
	const added = list(form, "addServiceIds");
	const candidates = list(form, "addServiceCandidate");
	return Object.entries(prefixed(form, "serviceStatus:"))
		.filter(([serviceId, status]) => {
			if (status === "") {
				return false;
			}
			if (selected && !selected.includes(serviceId)) {
				return false;
			}
			// A service in the add list keeps its status only when it is selected.
			if (candidates.includes(serviceId) && !added.includes(serviceId)) {
				return false;
			}
			return true;
		})
		.map(([serviceId, status]) => ({
			serviceId,
			status: status as ServiceStatus,
		}));
}

/**
 * Regions for the selected services.
 * Returns nothing when the form has no region choices.
 * A service in `serviceIds` with no checked region is Global.
 */
function regionsByService(form: FormData, serviceIds?: readonly string[]) {
	if (!form.has("serviceRegions")) {
		return undefined;
	}
	const entries: { serviceId: string; regionIds: string[] }[] = [];
	const seen = new Set<string>();
	for (const key of form.keys()) {
		if (!key.startsWith("regionIds:")) {
			continue;
		}
		const serviceId = key.slice("regionIds:".length);
		if (seen.has(serviceId)) {
			continue;
		}
		if (serviceIds && !serviceIds.includes(serviceId)) {
			continue;
		}
		seen.add(serviceId);
		entries.push({ serviceId, regionIds: list(form, key) });
	}
	if (serviceIds) {
		for (const serviceId of serviceIds) {
			if (!seen.has(serviceId)) {
				entries.push({ serviceId, regionIds: [] });
			}
		}
	}
	return entries;
}

function incidentInput(form: FormData) {
	const kind = (text(form, "kind") || "incident") as IncidentKind;
	const serviceIds = list(form, "serviceIds");
	return {
		kind,
		title: text(form, "title"),
		message: text(form, "message"),
		impact: nonEmpty(form, "impact") as IncidentImpact | undefined,
		status: nonEmpty(form, "status") as EventStatus | undefined,
		serviceIds,
		serviceStatus: nonEmpty(form, "serviceStatus") as ServiceStatus | undefined,
		serviceStatuses: serviceStatuses(form),
		serviceRegions: regionsByService(form, serviceIds),
		scheduledStart: dateTime(form, "scheduledStart"),
		scheduledEnd: dateTime(form, "scheduledEnd"),
		notify: checkbox(form, "notify"),
	};
}

async function createIncident(
	form: FormData,
	progress: boolean,
): Promise<SendResult | undefined> {
	const { actor, services } = await requireMemberForAction("editor");
	const input = incidentInput(form);
	const jobId = createId("njb");
	const incident = await attempt(
		`/manage/incidents/new?kind=${input.kind}`,
		() =>
			services.incidents.create(actor, input, {
				jobId,
				delivery: progress ? "background" : "wait",
			}),
	);
	const notice =
		input.kind === "incident" ? "incident_declared" : "maintenance_scheduled";
	return finishSend(services, actor, incident.id, jobId, notice, progress);
}

export async function createIncidentAction(form: FormData): Promise<void> {
	await createIncident(form, false);
}

/** Declares an incident and returns the job so the status window can poll. */
export async function createIncidentWithProgressAction(
	form: FormData,
): Promise<SendResult | undefined> {
	return createIncident(form, true);
}

/** The result of a send that stays on the page and shows the status window. */
export interface SendResult {
	jobId: string;
	href: string;
}

/** An incident id can be one segment of a portal path. */
const INCIDENT_ID = /^(?:inc|mnt)_[a-z0-9]+$/;

/**
 * Redirects after a send. A queued send opens the incident dashboard.
 * A direct send returns the job for the status window.
 * The path uses the incident id only when that id has the inc_ or mnt_ form.
 */
async function finishSend(
	services: App["services"],
	actor: Actor,
	incidentId: string,
	jobId: string,
	notice: FlashCode,
	progress: boolean,
	posts = false,
): Promise<SendResult | undefined> {
	const job = await services.notificationJobs.lookup(actor, jobId);
	// An id that is not an incident id does not become the redirect address.
	if (!INCIDENT_ID.test(incidentId)) {
		if (job?.queued) {
			redirect(flash("/manage/incidents", "notifications_queued"));
		}
		if (progress && job) {
			return { jobId: job.id, href: flash("/manage/incidents", notice) };
		}
		redirect(flash("/manage/incidents", notice));
	}
	if (job?.queued) {
		redirect(flash(`/manage/incidents/${incidentId}`, "notifications_queued"));
	}
	if (progress && job) {
		return {
			jobId: job.id,
			href: posts
				? flash(`/manage/incidents/${incidentId}?tab=posts`, notice)
				: flash(`/manage/incidents/${incidentId}`, notice),
		};
	}
	if (posts) {
		redirect(flash(`/manage/incidents/${incidentId}?tab=posts`, notice));
	}
	redirect(flash(`/manage/incidents/${incidentId}`, notice));
}

/** Opens the post form after an error. The posts tab stays on that tab. */
function postedPath(id: string, tab: string): string {
	const path = `/manage/incidents/${id}`;
	if (tab === "posts") {
		return `${path}?tab=posts&post=1`;
	}
	return `${path}?post=1`;
}

function updateInput(form: FormData) {
	const serviceIds = list(form, "addServiceIds");
	return {
		title: nonEmpty(form, "title"),
		impact: nonEmpty(form, "impact") as IncidentImpact | undefined,
		status: nonEmpty(form, "status") as EventStatus | undefined,
		message: text(form, "message"),
		serviceIds,
		serviceStatus: nonEmpty(form, "serviceStatus") as ServiceStatus | undefined,
		serviceStatuses: serviceStatuses(form),
		serviceRegions: regionsByService(form, serviceIds),
		notify: checkbox(form, "notify"),
	};
}

async function postIncidentUpdate(
	form: FormData,
	progress: boolean,
): Promise<SendResult | undefined> {
	const { actor, services } = await requireMemberForAction("editor");
	const id = text(form, "id");
	const tab = text(form, "tab");
	const jobId = createId("njb");
	await attempt(postedPath(id, tab), () =>
		services.incidents.postUpdate(actor, id, updateInput(form), {
			jobId,
			delivery: progress ? "background" : "wait",
		}),
	);
	return finishSend(
		services,
		actor,
		id,
		jobId,
		"update_posted",
		progress,
		tab === "posts",
	);
}

export async function postIncidentUpdateAction(form: FormData): Promise<void> {
	await postIncidentUpdate(form, false);
}

/** Posts an update and returns the job so the status window can poll. */
export async function postIncidentUpdateWithProgressAction(
	form: FormData,
): Promise<SendResult | undefined> {
	return postIncidentUpdate(form, true);
}

export async function editIncidentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
	const id = text(form, "id");
	await attempt(`/manage/incidents/${id}`, () =>
		services.incidents.edit(actor, id, {
			scheduledStart: dateTime(form, "scheduledStart"),
			scheduledEnd: dateTime(form, "scheduledEnd"),
			serviceRegions: form.has("serviceRegions")
				? regionsByService(form)
				: undefined,
		}),
	);
	redirect(flash(`/manage/incidents/${id}`, "incident_saved"));
}

export async function deleteIncidentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
	const id = text(form, "id");
	await attempt(`/manage/incidents/${id}`, () =>
		services.incidents.delete(actor, id, { reason: text(form, "reason") }),
	);
	redirect(flash("/manage/incidents", "incident_deleted"));
}

// ---- notification drafts ------------------------------------------------------------

/** The draft fields of the review form. Fields that the form does not show stay empty. */
function draftContent(form: FormData) {
	const serviceIds = list(form, "serviceIds");
	const addServiceIds = list(form, "addServiceIds");
	const boundServiceIds = list(form, "boundServiceIds");
	const ids = [
		...new Set([...serviceIds, ...addServiceIds, ...boundServiceIds]),
	];
	return {
		title: nonEmpty(form, "title"),
		impact: nonEmpty(form, "impact") as IncidentImpact | undefined,
		serviceIds: ids,
		scheduledStart: dateTime(form, "scheduledStart"),
		scheduledEnd: dateTime(form, "scheduledEnd"),
		status: nonEmpty(form, "status") as EventStatus | undefined,
		message: text(form, "message"),
		serviceStatus: nonEmpty(form, "serviceStatus") as ServiceStatus | undefined,
		serviceStatuses: serviceStatuses(form),
		serviceRegions: regionsByService(form, ids),
	};
}

export async function saveDraftAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
	const id = text(form, "id");
	await attempt(draftPath(id), () =>
		services.drafts.update(actor, id, draftContent(form)),
	);
	redirect(flash(draftPath(id), "draft_saved"));
}

async function approveDraft(
	form: FormData,
	progress: boolean,
): Promise<SendResult | undefined> {
	const { actor, services } = await requireMemberForAction("editor");
	const id = text(form, "id");
	const jobId = createId("njb");
	const { incident } = await attempt(draftPath(id), () =>
		services.drafts.approve(actor, id, draftContent(form), {
			jobId,
			delivery: progress ? "background" : "wait",
		}),
	);
	return finishSend(
		services,
		actor,
		incident.id,
		jobId,
		"draft_approved",
		progress,
	);
}

export async function approveDraftAction(form: FormData): Promise<void> {
	await approveDraft(form, false);
}

/** Approves a draft and returns the job so the status window can poll. */
export async function approveDraftWithProgressAction(
	form: FormData,
): Promise<SendResult | undefined> {
	return approveDraft(form, true);
}

export async function discardDraftAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
	const id = text(form, "id");
	await attempt(draftPath(id), () => services.drafts.discard(actor, id));
	redirect(flash("/manage/incidents", "draft_discarded"));
}

// ---- services -------------------------------------------------------------------

export async function createServiceAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
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
	const { actor, services } = await requireMemberForAction("editor");
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
	const { actor, services } = await requireMemberForAction("editor");
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
	const { actor, services } = await requireMemberForAction("editor");
	await attempt("/manage/services", () =>
		services.catalog.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/services", "service_deleted"));
}

// ---- regions -----------------------------------------------------------------------

export async function createRegionAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
	await attempt("/manage/regions", () =>
		services.regions.create(actor, {
			name: text(form, "name"),
			order: integer(form, "order"),
		}),
	);
	redirect(flash("/manage/regions", "region_created"));
}

export async function updateRegionAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
	await attempt("/manage/regions", () =>
		services.regions.update(actor, text(form, "id"), {
			name: text(form, "name"),
			order: integer(form, "order"),
		}),
	);
	redirect(flash("/manage/regions", "region_saved"));
}

export async function deleteRegionAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("editor");
	await attempt("/manage/regions", () =>
		services.regions.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/regions", "region_deleted"));
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
	const { actor, services, app } = await requireMemberForAction("admin");
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
	const { actor, services, app } = await requireMemberForAction("admin");
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
	const { actor, services } = await requireMemberForAction("admin");
	await attempt("/manage/members", () =>
		services.members.revokeInvite(actor, text(form, "id")),
	);
	redirect(flash("/manage/members", "invite_revoked"));
}

export async function updateMemberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt("/manage/members", () =>
		services.members.update(actor, text(form, "id"), {
			role: nonEmpty(form, "role") as Role | undefined,
			password: nonEmpty(form, "password"),
		}),
	);
	// The portal layout shows the role of the member who is signed in.
	revalidatePath("/manage", "layout");
	redirect(flash("/manage/members", "member_updated"));
}

export async function deleteMemberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt("/manage/members", () =>
		services.members.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/members", "member_removed"));
}

// ---- agents -----------------------------------------------------------------------

export interface CreateTokenState {
	token?: string;
	name?: string;
	error?: string;
}

export async function createAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	const agent = await attempt("/manage/agents/new", () =>
		services.agents.create(actor, {
			name: text(form, "name"),
			description: text(form, "description"),
			permissions: list(form, "permissions"),
		}),
	);
	revalidatePath("/manage/agents");
	redirect(flash(`/manage/agents/${agent.id}`, "agent_created"));
}

export async function updateAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction();
	const id = text(form, "id");
	const path = `/manage/agents/${encodeURIComponent(id)}`;
	await attempt(path, () =>
		services.agents.update(actor, id, {
			name: text(form, "name"),
			description: text(form, "description"),
			permissions:
				text(form, "editPermissions") === "true"
					? list(form, "permissions")
					: undefined,
			revision: integer(form, "revision") ?? -1,
		}),
	);
	revalidatePath(path);
	redirect(flash(path, "agent_saved"));
}

/** Used with `useActionState` so the token is shown once and never persisted. */
export async function createAgentTokenAction(
	_previous: CreateTokenState,
	form: FormData,
): Promise<CreateTokenState> {
	const { actor, services } = await requireMemberForAction("admin");
	return formState(async () => {
		const agentId = text(form, "agentId");
		const { token, agent } = await services.agents.createToken(actor, agentId, {
			expiresInDays: integer(form, "expiresInDays"),
		});
		revalidatePath(`/manage/agents/${agentId}`);
		return { token, name: agent.name };
	});
}

/** Keeps a return path only when that path is an agents page on this site. */
function agentReturnPath(value: string): string {
	if (/^\/manage\/agents(?:\/[a-z0-9_]+)?$/.test(value)) {
		return value;
	}
	return "/manage/agents";
}

export async function revokeAgentTokenAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	const next = agentReturnPath(text(form, "next"));
	await attempt(next, () =>
		services.agents.revokeToken(actor, text(form, "id")),
	);
	redirect(flash(next, "token_revoked"));
}

export async function deleteAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt("/manage/agents", () =>
		services.agents.delete(actor, text(form, "id")),
	);
	redirect(flash("/manage/agents", "agent_deleted"));
}

// ---- connected agents -------------------------------------------------------------

/** Reads an authorization request that the consent page posts. */
async function authorizationRequest(form: FormData) {
	const { actor, services } = await requireMemberForAction();
	const { siteUrl } = await services.settings.get();
	return {
		actor,
		services,
		params: authorizationParams((key) => form.get(key)),
		resource: await publicMcpEndpoint(siteUrl),
	};
}

/** The member allows the agent. The agent gets an authorization code. */
export async function approveAgentAction(form: FormData): Promise<void> {
	const { actor, services, params, resource } =
		await authorizationRequest(form);
	redirect(
		await attempt(authorizePath(params), () =>
			services.oauth.approve(
				actor,
				params,
				resource,
				text(form, "choice") === "existing"
					? { agentId: text(form, "agentId") }
					: { name: text(form, "name") },
			),
		),
	);
}

/** The member denies the agent. The agent gets an `access_denied` error. */
export async function denyAgentAction(form: FormData): Promise<void> {
	const { services, params, resource } = await authorizationRequest(form);
	redirect(
		await attempt(authorizePath(params), () =>
			services.oauth.deny(params, resource),
		),
	);
}

export async function disconnectAgentAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction();
	const next = agentReturnPath(text(form, "next"));
	await attempt(next, () => services.oauth.disconnect(actor, text(form, "id")));
	redirect(flash(next, "agent_disconnected"));
}

// ---- subscribers --------------------------------------------------------------------

export async function addSubscriberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt("/manage/subscribers", () =>
		services.subscribers.add(actor, {
			type: text(form, "type"),
			target: text(form, "target"),
			...(form.has("serviceIds")
				? { serviceIds: list(form, "serviceIds") }
				: {}),
		}),
	);
	redirect(flash("/manage/subscribers", "subscriber_added"));
}

export async function updateSubscriberServicesAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt("/manage/subscribers", () =>
		services.subscribers.setServices(actor, text(form, "id"), {
			serviceIds: list(form, "serviceIds"),
		}),
	);
	redirect(flash("/manage/subscribers", "services_saved"));
}

export async function deleteSubscriberAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt("/manage/subscribers", () =>
		services.subscribers.remove(actor, text(form, "id")),
	);
	redirect(flash("/manage/subscribers", "subscriber_removed"));
}

// ---- settings -----------------------------------------------------------------------

const GENERAL_PATH = "/manage/settings";
const BRANDING_PATH = "/manage/settings/branding";
const NOTIFICATIONS_PATH = "/manage/settings/notifications";

export async function updateGeneralSettingsAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt(GENERAL_PATH, () =>
		services.settings.update(actor, {
			siteName: text(form, "siteName"),
			description: text(form, "description"),
			siteUrl: optionalText(form, "siteUrl"),
			supportUrl: optionalText(form, "supportUrl"),
			uptimeDays: integer(form, "uptimeDays"),
			requireTwoFactor: checkbox(form, "requireTwoFactor"),
		}),
	);
	// The root layout and the portal layout show the settings.
	revalidatePath("/", "layout");
	redirect(flash(GENERAL_PATH, "settings_saved"));
}

/** The change that the branding form asks for one file. A new file wins over the remove flag. */
async function brandAssetChange(
	form: FormData,
	field: string,
	removeField: string,
): Promise<BrandAssetChange | undefined> {
	const file = form.get(field);
	if (file instanceof File && file.size > 0) {
		return { bytes: new Uint8Array(await file.arrayBuffer()) };
	}
	return checkbox(form, removeField) ? { remove: true } : undefined;
}

export async function updateBrandingAction(form: FormData): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt(BRANDING_PATH, async () => {
		await services.settings.updateBranding(
			actor,
			{
				theme: text(form, "theme"),
				customCss: optionalText(form, "customCss"),
				showPoweredBy: checkbox(form, "showPoweredBy"),
			},
			{
				logo: await brandAssetChange(form, "logo", "removeLogo"),
				favicon: await brandAssetChange(form, "favicon", "removeFavicon"),
			},
		);
	});
	// The root layout and the portal layout show the settings.
	revalidatePath("/", "layout");
	redirect(flash(BRANDING_PATH, "branding_saved"));
}

// ---- notification channels -------------------------------------------------------------

/** The channel of a notification form. The service validates the value. */
function channelOf(form: FormData): NotificationChannel {
	return text(form, "channel") as NotificationChannel;
}

export async function updateNotificationChannelAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	const channel = channelOf(form);
	await attempt(NOTIFICATIONS_PATH, () =>
		services.notificationSettings.updateChannel(actor, channel, {
			revision: integer(form, "revision"),
			enabled: checkbox(form, "enabled"),
			// The webhook form has no strategy field.
			strategy: optionalText(form, "strategy") as DeliveryStrategy | undefined,
			from: optionalText(form, "from"),
			// Only the webhook card has this box.
			...(channel === "webhook"
				? { allowPrivateNetworks: checkbox(form, "allowPrivateNetworks") }
				: {}),
		}),
	);
	redirect(flash(NOTIFICATIONS_PATH, "notification_channel_saved"));
}

export async function updateNotificationQueueAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	const raw = text(form, "provider");
	const provider =
		raw === "" || raw === "none" ? undefined : (raw as QueueProviderId);
	const result = await attempt(NOTIFICATIONS_PATH, () =>
		services.notificationQueue.update(actor, {
			revision: integer(form, "revision") ?? Number.NaN,
			provider,
			uri: nonEmpty(form, "uri"),
		}),
	);
	redirect(
		flash(
			NOTIFICATIONS_PATH,
			result.ready ? "notification_queue_saved" : "queue_unreachable",
		),
	);
}

export async function addNotificationProviderAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt(NOTIFICATIONS_PATH, () =>
		services.notificationSettings.addProvider(actor, channelOf(form), {
			type: text(form, "type") as ProviderType,
			name: text(form, "name"),
			from: optionalText(form, "from"),
			values: prefixed(form, "field_"),
		}),
	);
	redirect(flash(NOTIFICATIONS_PATH, "notification_provider_added"));
}

export async function updateNotificationProviderAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt(NOTIFICATIONS_PATH, () =>
		services.notificationSettings.updateProvider(
			actor,
			channelOf(form),
			text(form, "id"),
			{
				revision: integer(form, "revision"),
				name: text(form, "name"),
				from: optionalText(form, "from"),
				values: prefixed(form, "field_"),
				clear: list(form, "clear"),
			},
		),
	);
	redirect(flash(NOTIFICATIONS_PATH, "notification_provider_saved"));
}

export async function moveNotificationProviderAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt(NOTIFICATIONS_PATH, () =>
		services.notificationSettings.moveProvider(
			actor,
			channelOf(form),
			text(form, "id"),
			text(form, "direction") as MoveDirection,
		),
	);
	redirect(flash(NOTIFICATIONS_PATH, "notification_provider_moved"));
}

export async function removeNotificationProviderAction(
	form: FormData,
): Promise<void> {
	const { actor, services } = await requireMemberForAction("admin");
	await attempt(NOTIFICATIONS_PATH, () =>
		services.notificationSettings.removeProvider(
			actor,
			channelOf(form),
			text(form, "id"),
		),
	);
	redirect(flash(NOTIFICATIONS_PATH, "notification_provider_removed"));
}
