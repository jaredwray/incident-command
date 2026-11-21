import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type App, getApp } from "./app";
import { hasRole } from "./domain/status";
import type { Actor, PublicMember, Role, SessionPurpose } from "./domain/types";
import { flash, roleFlashCode } from "./flash";
import { memberActor } from "./services/members";
import type { SessionResult } from "./services/sessions";
import type { ReadOptions } from "./store/types";

export { flash } from "./flash";

export const SESSION_COOKIE = "ic_session";

export interface MemberContext {
	member: PublicMember;
	actor: Actor;
	services: App["services"];
	app: App;
}

/** Options for a portal page that must open before authenticator setup. */
export interface AccessOptions {
	/** The account page uses this while the member turns an authenticator on. */
	allowMissingTwoFactor?: boolean;
}

/** Whether session cookies should be marked `Secure`. */
export function secureCookies(siteUrl: string | undefined): boolean {
	return siteUrl
		? siteUrl.startsWith("https://")
		: process.env.NODE_ENV === "production";
}

/**
 * The signed-in member for this request, if any. A page uses the session
 * cache. A caller that changes data sets `consistent` to read the database.
 */
export async function getMemberContext(
	options?: ReadOptions,
): Promise<MemberContext | undefined> {
	const app = await getApp();
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	const result = await app.services.sessions.resolve(token, options);
	if (!result) {
		return undefined;
	}
	const { member } = result;
	return { member, actor: memberActor(member), services: app.services, app };
}

/**
 * The path to go to after sign-in. Only portal paths of printable ASCII are
 * permitted, so a link cannot send a person to a different site.
 */
export function returnPath(value: string | undefined): string {
	return value && /^\/manage(?:[/?][\x21-\x7e]*)?$/.test(value)
		? value
		: "/manage";
}

/** The sign-in path. After sign-in, the member goes to `next`. */
export function loginPath(next?: string): string {
	const path = returnPath(next);
	return path === "/manage"
		? "/manage/login"
		: `/manage/login?next=${encodeURIComponent(path)}`;
}

/** The authenticator page. After the check, the member goes to `next`. */
export function twoFactorPath(next?: string): string {
	const path = returnPath(next);
	return path === "/manage"
		? "/manage/login/two-factor"
		: `/manage/login/two-factor?next=${encodeURIComponent(path)}`;
}

function authorize(
	context: MemberContext | undefined,
	role: Role,
	next?: string,
): MemberContext {
	if (!context) {
		redirect(loginPath(next));
	}
	if (!hasRole(context.member.role, role)) {
		redirect(flash("/manage", roleFlashCode(role)));
	}
	return context;
}

async function enforceTwoFactor(
	context: MemberContext,
	options?: AccessOptions,
): Promise<MemberContext> {
	if (options?.allowMissingTwoFactor || context.member.twoFactorEnabled) {
		return context;
	}
	const settings = await context.services.settings.get();
	if (!settings.requireTwoFactor) {
		return context;
	}
	redirect(flash("/manage/account", "two_factor_required"));
}

/**
 * Requires a signed-in member with at least `role`, redirecting otherwise.
 * A visitor who is not signed in comes back to `next` after sign-in. Use this
 * function in a page. It can use a cached session.
 */
export async function requireMember(
	role: Role = "viewer",
	next?: string,
	options?: AccessOptions,
): Promise<MemberContext> {
	return enforceTwoFactor(
		authorize(await getMemberContext(), role, next),
		options,
	);
}

/**
 * Requires a signed-in member with at least `role`, redirecting otherwise.
 * Use this function in a server action. It reads the session and the member
 * from the database, so a change to a session or a role applies immediately.
 */
export async function requireMemberForAction(
	role: Role = "viewer",
	options?: AccessOptions,
): Promise<MemberContext> {
	return enforceTwoFactor(
		authorize(await getMemberContext({ consistent: true }), role),
		options,
	);
}

/**
 * The signed-in member for a portal JSON route. Returns nothing when the
 * visitor is signed out, or when the authenticator rule blocks the portal.
 */
export async function getMemberForApi(): Promise<MemberContext | undefined> {
	const context = await getMemberContext({ consistent: true });
	if (!context) {
		return undefined;
	}
	if (context.member.twoFactorEnabled) {
		return context;
	}
	const settings = await context.services.settings.get();
	if (settings.requireTwoFactor) {
		return undefined;
	}
	return context;
}

async function setSessionCookie(
	app: App,
	token: string,
	expiresAt: string,
): Promise<void> {
	(await cookies()).set(SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: "lax",
		secure: secureCookies(app.config.siteUrl),
		path: "/",
		expires: new Date(expiresAt),
	});
}

/** Starts a session for a member (server actions only). */
export async function startSession(app: App, memberId: string): Promise<void> {
	const { token, session } = await app.services.sessions.create(memberId);
	await setSessionCookie(app, token, session.expiresAt);
}

/** Starts a short sign-in challenge. The cookie is not a portal session yet. */
export async function startPendingSession(
	app: App,
	memberId: string,
	purpose: SessionPurpose,
): Promise<void> {
	const { token, session } = await app.services.sessions.create(memberId, {
		purpose,
	});
	await setSessionCookie(app, token, session.expiresAt);
}

/** The open authenticator challenge for this request. */
export async function pendingLogin(
	app: App,
): Promise<SessionResult | undefined> {
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	return app.services.sessions.resolvePending(token);
}

/** Turns the challenge cookie into a portal session. */
export async function promoteSession(app: App): Promise<void> {
	const jar = await cookies();
	const token = jar.get(SESSION_COOKIE)?.value;
	if (!token) {
		redirect("/manage/login");
	}
	const session = await app.services.sessions.promote(token);
	if (!session) {
		redirect("/manage/login");
	}
	await setSessionCookie(app, token, session.expiresAt);
}

/** Counts a wrong authenticator code and sends the member back. */
export async function failTwoFactor(app: App, next: string): Promise<never> {
	const jar = await cookies();
	const token = jar.get(SESSION_COOKIE)?.value;
	const result = await app.services.sessions.failPending(token);
	if (result === "retry") {
		redirect(flash(twoFactorPath(next), "invalid_two_factor"));
	}
	jar.delete(SESSION_COOKIE);
	if (result === "locked") {
		redirect(flash(loginPath(next), "too_many_two_factor"));
	}
	redirect(loginPath(next));
}

/** Ends the current session (server actions only). */
export async function endSession(app: App): Promise<void> {
	const jar = await cookies();
	await app.services.sessions.destroy(jar.get(SESSION_COOKIE)?.value);
	jar.delete(SESSION_COOKIE);
}
