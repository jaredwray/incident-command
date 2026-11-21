import { BRAND_ASSET_MESSAGES } from "./domain/brand-asset";
import {
	INVALID_TWO_FACTOR_CODE,
	TWO_FACTOR_ALREADY_OFF,
	TWO_FACTOR_ALREADY_ON,
	TWO_FACTOR_NOT_READY,
	TWO_FACTOR_REQUIRED_BY_ADMIN,
	TWO_FACTOR_SECRET_UNREADABLE,
} from "./domain/totp";
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
	[INVALID_TWO_FACTOR_CODE]: "invalid_two_factor",
	[TWO_FACTOR_ALREADY_ON]: "two_factor_already_on",
	[TWO_FACTOR_ALREADY_OFF]: "two_factor_already_off",
	[TWO_FACTOR_REQUIRED_BY_ADMIN]: "two_factor_required_by_admin",
	[TWO_FACTOR_SECRET_UNREADABLE]: "two_factor_secret_unreadable",
	[TWO_FACTOR_NOT_READY]: "two_factor_not_ready",
	"Maintenance requires scheduledStart and scheduledEnd":
		"maintenance_window_required",
	"Write a reason before you delete the incident.": "delete_reason_required",
	"This invite link is not valid. Ask an admin for a new invite.":
		"invite_invalid",
	"You cannot remove the last admin": "last_admin",
	"A member with that email already exists": "member_email_exists",
	"Global is the default region. Choose another name.": "region_name_global",
	"A region with that name already exists": "region_name_taken",
	"scheduledEnd must be after scheduledStart": "scheduled_end_before_start",
	"Subscriptions are not enabled": "subscriptions_disabled",
	"We couldn't send the confirmation. Please try again later.":
		"confirmation_not_sent",
	"You do not have permission to do that": "forbidden",
	"Authentication required": "unauthorized",
	"The data store is unavailable": "unavailable",
	"This draft was already approved": "draft_already_approved",
	"This draft was already discarded": "draft_already_discarded",
	"Somebody else reviewed this draft at the same time. Reload the draft.":
		"draft_reviewed_meanwhile",
	"Set ENCRYPTION_KEY on the server before you save provider credentials.":
		"encryption_key_missing",
	"Somebody else changed these notification settings. Reload the page.":
		"notification_settings_changed",
	"Somebody else changed the queue settings. Reload the page.":
		"notification_queue_changed",
	"The connection URI is not correct for this provider.": "queue_uri_invalid",
	"Somebody changed this agent. Examine the new values and save again.":
		"agent_changed",
	[BRAND_ASSET_MESSAGES.logo.type]: "logo_type",
	[BRAND_ASSET_MESSAGES.logo.size]: "logo_too_large",
	[BRAND_ASSET_MESSAGES.logo.svg]: "logo_svg",
	[BRAND_ASSET_MESSAGES.favicon.type]: "favicon_type",
	[BRAND_ASSET_MESSAGES.favicon.size]: "favicon_too_large",
	[BRAND_ASSET_MESSAGES.favicon.svg]: "favicon_svg",
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
