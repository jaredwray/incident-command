import { hmacSha256, safeEqual } from "./crypto";

export type FlashKind = "notice" | "error";

const MAX_MESSAGE_LENGTH = 500;
/** Used only outside production when no FLASH_SECRET or SETUP_TOKEN is set. */
const DEV_FLASH_KEY = "incident-command-dev-flash";

/**
 * Secret that signs flash query values.
 * Prefer `FLASH_SECRET`, then `SETUP_TOKEN`.
 * Outside production, falls back to a fixed local key.
 * In production with no secret, returns `undefined` (flashes stay off).
 */
export function flashSigningKey(
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const key = env.FLASH_SECRET?.trim() || env.SETUP_TOKEN?.trim();
	if (key) {
		return key;
	}
	if ((env.NODE_ENV ?? "development") !== "production") {
		return DEV_FLASH_KEY;
	}
	return undefined;
}

/** Signs a flash message for a query parameter. */
export function sealFlash(
	kind: FlashKind,
	message: string,
	secret: string | undefined = flashSigningKey(),
): string | undefined {
	if (!secret) {
		return undefined;
	}
	const text = message.slice(0, MAX_MESSAGE_LENGTH);
	const payload = Buffer.from(text, "utf8").toString("base64url");
	const sig = hmacSha256(secret, `${kind}.${payload}`);
	return `${payload}.${sig}`;
}

/** Returns the message when the flash token is valid; otherwise `undefined`. */
export function readFlash(
	kind: FlashKind,
	token: string | undefined,
	secret: string | undefined = flashSigningKey(),
): string | undefined {
	if (!secret || !token) {
		return undefined;
	}
	const dot = token.lastIndexOf(".");
	if (dot <= 0 || dot === token.length - 1) {
		return undefined;
	}
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expected = hmacSha256(secret, `${kind}.${payload}`);
	if (!safeEqual(sig, expected)) {
		return undefined;
	}
	const message = Buffer.from(payload, "base64url").toString("utf8");
	if (!message || message.length > MAX_MESSAGE_LENGTH) {
		return undefined;
	}
	return message;
}

/** Appends a signed flash message (`notice` or `error`) to a path. */
export function flash(path: string, kind: FlashKind, message: string): string {
	const sealed = sealFlash(kind, message);
	if (!sealed) {
		return path;
	}
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}${kind}=${encodeURIComponent(sealed)}`;
}

/** Resolves signed flash query values into display text. */
export function resolveFlash(params: { notice?: string; error?: string }): {
	notice?: string;
	error?: string;
} {
	const notice = readFlash("notice", params.notice);
	const error = readFlash("error", params.error);
	return {
		...(notice ? { notice } : {}),
		...(error ? { error } : {}),
	};
}
