import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import {
	authorRef,
	iso,
	parse,
	requireRole,
	SYSTEM_ACTOR,
} from "@/lib/services/context";
import { EDITOR, VIEWER } from "../helpers";

describe("service context helpers", () => {
	it("formats validation errors with and without paths", () => {
		const schema = z.object({ name: z.string().min(2) });
		expect(() => parse(schema, { name: "x" })).toThrow(ValidationError);
		expect(() => parse(schema, { name: "x" })).toThrow(/^name: /);
		expect(() => parse(schema, "nope")).toThrow(/^Invalid input/);
		expect(parse(schema, { name: "ok" })).toEqual({ name: "ok" });
	});

	it("checks roles and builds author refs", () => {
		expect(() => requireRole(VIEWER, "editor")).toThrow(
			/requires the editor role/,
		);
		expect(() => requireRole(EDITOR, "editor")).not.toThrow();
		expect(authorRef(EDITOR)).toEqual({
			type: "member",
			id: EDITOR.id,
			name: EDITOR.name,
		});
		expect(SYSTEM_ACTOR.role).toBe("admin");
		expect(iso(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
	});
});
