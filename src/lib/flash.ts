import type { Role } from "./domain/types";
import type { AppError, ErrorCode } from "./errors";
import catalog from "./flash-messages.json";

export type FlashKind = "notice" | "error";

export type FlashCode = keyof typeof catalog;

export interface FlashEntry {
	id: string;
	kind: FlashKind;
	text: string;
}

const MESSAGES = catalog as Record<FlashCode, FlashEntry>;

/** Exact AppError messages that map to a catalog code. */
const MESSAGE_CODES: Record<string, FlashCode> = {
	"Invalid setup token": "invalid_setup_token",
	"Setup has already been completed": "setup_completed",
	"Current password is incorrect": "current_password_incorrect",
	"Maintenance requires scheduledStart and scheduledEnd":
		"maintenance_window_required",
	"This invite link is not valid. Ask an admin for a new invite.":
		"invite_invalid",
	"You cannot remove the last admin": "last_admin",
	"A member with that email already exists": "member_email_exists",
	"scheduledEnd must be after scheduledStart": "scheduled_end_before_start",
	"Subscriptions are not enabled": "subscriptions_disabled",
	"You do not have permission to do that": "forbidden",
	"Authentication required": "unauthorized",
	"The data store is unavailable": "unavailable",
};

const ERROR_CODE_FLASH: Record<ErrorCode, FlashCode> = {
	bad_request: "validation_failed",
	unauthorized: "unauthorized",
	forbidden: "forbidden",
	not_found: "not_found",
	conflict: "conflict",
	unavailable: "unavailable",
};

const ROLE_FLASH: Record<Role, FlashCode> = {
	viewer: "role_required_viewer",
	editor: "role_required_editor",
	admin: "role_required_admin",
};

/** Returns a catalog entry for a flash code, if it exists. */
export function flashEntry(code: string | undefined): FlashEntry | undefined {
	if (!code || !(code in MESSAGES)) {
		return undefined;
	}
	return MESSAGES[code as FlashCode];
}

/** Flash code for a missing-role redirect. */
export function roleFlashCode(role: Role): FlashCode {
	return ROLE_FLASH[role];
}

/** Flash code for an expected application error. */
export function flashCodeForError(error: AppError): FlashCode {
	return MESSAGE_CODES[error.message] ?? ERROR_CODE_FLASH[error.code];
}

/** Returns the display text when the query value is a known flash code. */
export function readFlash(
	kind: FlashKind,
	code: string | undefined,
): string | undefined {
	const entry = flashEntry(code);
	if (!entry || entry.kind !== kind) {
		return undefined;
	}
	return entry.text;
}

/** Appends a flash code (`notice` or `error`) to a path. */
export function flash(path: string, code: FlashCode): string {
	const entry = MESSAGES[code];
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}${entry.kind}=${encodeURIComponent(code)}`;
}

/** Resolves flash query codes into display text. */
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
