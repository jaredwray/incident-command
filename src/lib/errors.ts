export type ErrorCode =
	| "bad_request"
	| "unauthorized"
	| "forbidden"
	| "not_found"
	| "conflict"
	| "unavailable";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
	bad_request: 400,
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	unavailable: 503,
};

/**
 * Marks an `AppError`. `Symbol.for` gives the same symbol in each copy of this
 * module. Next.js can load a different copy for pages and server actions, so
 * `instanceof` is not sufficient.
 */
const APP_ERROR = Symbol.for("incident-command.AppError");

/** Base class for expected, user-facing errors. */
export class AppError extends Error {
	readonly code: ErrorCode;
	readonly [APP_ERROR] = true;

	constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AppError";
		this.code = code;
	}

	get status(): number {
		return STATUS_BY_CODE[this.code];
	}
}

export class ValidationError extends AppError {
	constructor(message: string) {
		super("bad_request", message);
		this.name = "ValidationError";
	}
}

export class UnauthorizedError extends AppError {
	constructor(message = "Authentication required") {
		super("unauthorized", message);
		this.name = "UnauthorizedError";
	}
}

export class ForbiddenError extends AppError {
	constructor(message = "You do not have permission to do that") {
		super("forbidden", message);
		this.name = "ForbiddenError";
	}
}

export class NotFoundError extends AppError {
	constructor(entity: string, id: string) {
		super("not_found", `${entity} "${id}" was not found`);
		this.name = "NotFoundError";
	}
}

export class ConflictError extends AppError {
	constructor(message: string) {
		super("conflict", message);
		this.name = "ConflictError";
	}
}

export class StoreUnavailableError extends AppError {
	constructor(cause: unknown) {
		super("unavailable", "The data store is unavailable", { cause });
		this.name = "StoreUnavailableError";
	}
}

export function isAppError(error: unknown): error is AppError {
	return error instanceof Error && APP_ERROR in error;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
