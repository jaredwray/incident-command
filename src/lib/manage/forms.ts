import { redirect } from "next/navigation";
import { isAppError } from "../errors";
import { flash, flashCodeForError } from "../flash";
import { fromDateTimeInput } from "../format";

/** A form value as a string (`""` when missing). */
export function text(form: FormData, key: string): string {
	const value = form.get(key);
	return typeof value === "string" ? value : "";
}

/** A form value, or `undefined` when the field was not submitted. */
export function optionalText(form: FormData, key: string): string | undefined {
	return form.has(key) ? text(form, key) : undefined;
}

/** A form value, or `undefined` when missing or empty. */
export function nonEmpty(form: FormData, key: string): string | undefined {
	return text(form, key) || undefined;
}

export function checkbox(form: FormData, key: string): boolean {
	return form.get(key) === "on";
}

export function list(form: FormData, key: string): string[] {
	return form
		.getAll(key)
		.map(String)
		.filter((value) => value !== "");
}

/** Every text value whose key starts with `prefix`, keyed without the prefix. */
export function prefixed(
	form: FormData,
	prefix: string,
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const key of form.keys()) {
		if (key.startsWith(prefix)) {
			values[key.slice(prefix.length)] = text(form, key);
		}
	}
	return values;
}

export function integer(form: FormData, key: string): number | undefined {
	const value = text(form, key).trim();
	return value === "" ? undefined : Number(value);
}

/** A `datetime-local` value (UTC) as ISO, or `undefined` when empty. */
export function dateTime(form: FormData, key: string): string | undefined {
	return fromDateTimeInput(text(form, key));
}

/**
 * Runs an operation and, if it fails with an expected application error,
 * redirects back to `failurePath` with the error as a flash message.
 */
export async function attempt<T>(
	failurePath: string,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (isAppError(error)) {
			redirect(flash(failurePath, flashCodeForError(error)));
		}
		throw error;
	}
}
