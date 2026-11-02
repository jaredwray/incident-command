import { applyQuery, matchesCondition, sortRows } from "@/lib/store/query";

describe("query helpers", () => {
	it("sorts missing values last ascending and first descending", () => {
		const rows = [
			{ id: "a", v: 2 },
			{ id: "b" },
			{ id: "c", v: 1 },
			{ id: "d", v: null },
		];
		expect(sortRows([...rows], [{ field: "v" }]).map((r) => r.id)).toEqual([
			"c",
			"a",
			"b",
			"d",
		]);
		expect(
			sortRows([...rows], [{ field: "v", direction: "desc" }]).map((r) => r.id),
		).toEqual(["b", "d", "a", "c"]);
	});

	it("never matches range conditions on missing values", () => {
		expect(matchesCondition({}, { field: "v", op: "lt", value: 5 })).toBe(
			false,
		);
		expect(
			matchesCondition({ v: null }, { field: "v", op: "gte", value: 0 }),
		).toBe(false);
		expect(
			matchesCondition({ v: 5 }, { field: "v", op: "lte", value: 5 }),
		).toBe(true);
	});

	it("applies limit and offset without sort", () => {
		expect(
			applyQuery([{ id: "a" }, { id: "b" }, { id: "c" }], {
				offset: 1,
				limit: 1,
			}),
		).toEqual([{ id: "b" }]);
		expect(applyQuery([{ id: "a" }], undefined)).toEqual([{ id: "a" }]);
	});
});
