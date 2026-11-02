import type { Condition, Query, Scalar, SortSpec } from "./types";

type Row = Record<string, unknown>;

/** Orders values ascending with missing (`null`/`undefined`) values last. */
function compare(a: unknown, b: unknown): number {
	const aMissing = a === undefined || a === null;
	const bMissing = b === undefined || b === null;
	if (a === b || (aMissing && bMissing)) {
		return 0;
	}
	if (aMissing) {
		return 1;
	}
	if (bMissing) {
		return -1;
	}
	return (a as string | number) < (b as string | number) ? -1 : 1;
}

export function matchesCondition(row: Row, condition: Condition): boolean {
	const value = row[condition.field];
	switch (condition.op) {
		case "eq":
			return condition.value === null
				? value === undefined || value === null
				: value === condition.value;
		case "ne":
			return value !== condition.value;
		case "in":
			return condition.value.includes(value as Scalar);
		default: {
			if (value === undefined || value === null) {
				return false;
			}
			const order = compare(value, condition.value);
			switch (condition.op) {
				case "gt":
					return order > 0;
				case "gte":
					return order >= 0;
				case "lt":
					return order < 0;
				default:
					return order <= 0;
			}
		}
	}
}

export function matchesQuery(row: Row, query: Query | undefined): boolean {
	return (query?.where ?? []).every((condition) =>
		matchesCondition(row, condition),
	);
}

export function sortRows<T extends Row>(rows: T[], sort: readonly SortSpec[]) {
	return rows.sort((a, b) => {
		for (const spec of sort) {
			const order = compare(a[spec.field], b[spec.field]);
			if (order !== 0) {
				return spec.direction === "desc" ? -order : order;
			}
		}
		return 0;
	});
}

/** Applies a portable query to an in-memory list of documents. */
export function applyQuery<T extends Row>(
	rows: Iterable<T>,
	query: Query | undefined,
): T[] {
	const filtered = [...rows].filter((row) => matchesQuery(row, query));
	const sorted = query?.sort ? sortRows(filtered, query.sort) : filtered;
	const offset = query?.offset ?? 0;
	const end = query?.limit === undefined ? undefined : offset + query.limit;
	return sorted.slice(offset, end);
}
