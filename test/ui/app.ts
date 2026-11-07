import { type App, createApp, setApp } from "@/lib/app";
import { SESSION_COOKIE } from "@/lib/auth";
import { loadConfig } from "@/lib/config";
import type { Role } from "@/lib/domain/types";
import { SYSTEM_ACTOR } from "@/lib/services/context";
import { memberActor } from "@/lib/services/members";
import { Clock, FakeNotifier } from "../helpers";
import { cookieJar, NotFound, Redirect } from "./next-state";

export async function setupApp(env: Record<string, string> = {}) {
	const clock = new Clock();
	const notifier = new FakeNotifier();
	const app = await createApp({
		config: loadConfig(env),
		notifier,
		now: clock.now,
	});
	setApp(app);
	return { app, clock, notifier, services: app.services };
}

export async function signIn(app: App, role: Role = "admin") {
	const invite = await app.services.members.invite(SYSTEM_ACTOR, {
		email: `${role}-${Math.random().toString(36).slice(2)}@test.dev`,
		role,
	});
	const member = await app.services.members.acceptInvite(invite.token, {
		name: `${role[0]?.toUpperCase()}${role.slice(1)} User`,
		password: "password123",
	});
	const { token } = await app.services.sessions.create(member.id);
	cookieJar.set(SESSION_COOKIE, token);
	return { member, actor: memberActor(member) };
}

export function form(entries: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) {
		for (const item of Array.isArray(value) ? value : [value]) {
			data.append(key, item);
		}
	}
	return data;
}

/** Awaits a server action/page and returns the URL it redirected to. */
export async function redirectOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Redirect) {
			return decodeURIComponent(error.url);
		}
		throw error;
	}
	throw new Error("Expected a redirect");
}

export async function expectNotFound(promise: Promise<unknown>) {
	await expect(promise).rejects.toBeInstanceOf(NotFound);
}

export const params = <T>(value: T) => Promise.resolve(value);
