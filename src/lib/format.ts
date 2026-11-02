const UTC = "UTC";

const dateTime = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZone: UTC,
});
const day = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: UTC,
});
const month = new Intl.DateTimeFormat("en-US", {
	month: "long",
	year: "numeric",
	timeZone: UTC,
});
const shortMonth = new Intl.DateTimeFormat("en-US", {
	month: "short",
	year: "numeric",
	timeZone: UTC,
});

/** `Nov 2, 2026, 14:05 UTC` */
export function formatDateTime(iso: string): string {
	return `${dateTime.format(new Date(iso))} UTC`;
}

/** `Nov 2, 2026` from an ISO timestamp or a `YYYY-MM-DD` key. */
export function formatDay(value: string): string {
	return day.format(
		new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value),
	);
}

/** `November 2026` from a `YYYY-MM` key. */
export function formatMonth(key: string): string {
	return month.format(new Date(`${key}-01T00:00:00.000Z`));
}

/** `Aug 2026 – Nov 2026` */
export function formatMonthRange(start: Date, end: Date): string {
	const from = shortMonth.format(start);
	const to = shortMonth.format(end);
	return from === to ? from : `${from} – ${to}`;
}

/** Formats a duration in ms as `2h 5m`, `45m` or `< 1m`. */
export function formatDuration(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) {
		return "< 1m";
	}
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	const rest = minutes % 60;
	return [days && `${days}d`, hours && `${hours}h`, rest && `${rest}m`]
		.filter(Boolean)
		.join(" ");
}

/** Converts an ISO timestamp to a `datetime-local` input value in UTC. */
export function toDateTimeInput(iso: string | undefined): string {
	return iso ? iso.slice(0, 16) : "";
}

/** Converts a `datetime-local` value (interpreted as UTC) to ISO, or `undefined` when empty. */
export function fromDateTimeInput(
	value: string | undefined,
): string | undefined {
	if (!value) {
		return undefined;
	}
	const date = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
	return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
