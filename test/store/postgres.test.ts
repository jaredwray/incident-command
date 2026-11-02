import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { Component } from "@/lib/domain/types";
import { ConflictError } from "@/lib/errors";
import { MemoryStore } from "@/lib/store/memory";
import { PostgresStore, type SqlClient } from "@/lib/store/postgres";
import type { CollectionName, Query } from "@/lib/store/types";
import { runStoreContract } from "./contract";

function component(id: string, overrides: Partial<Component> = {}): Component {
	return {
		id,
		name: `Component ${id}`,
		status: "operational",
		order: 0,
		hidden: false,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

/** Documents with explicit nulls, missing fields and mixed values to compare against MemoryStore. */
const PARITY_DOCS = [
	{ id: "p1", name: "A", score: 3, tag: "x", flag: true, note: null },
	{ id: "p2", name: "B", score: 10, tag: "y", flag: false },
	{ id: "p3", name: "C", score: null, tag: null },
	{ id: "p4", name: "D" },
	{ id: "p5", name: "E", score: 2.5, tag: "x", note: "n" },
] as unknown as Component[];

const PARITY_QUERIES: Query[] = [
	{ where: [{ field: "score", op: "eq", value: null }] },
	{ where: [{ field: "score", op: "ne", value: null }] },
	{ where: [{ field: "note", op: "eq", value: null }] },
	{ where: [{ field: "note", op: "ne", value: null }] },
	{ where: [{ field: "score", op: "eq", value: 3 }] },
	{ where: [{ field: "tag", op: "ne", value: "x" }] },
	{ where: [{ field: "flag", op: "eq", value: false }] },
	{ where: [{ field: "tag", op: "in", value: [null, "y"] }] },
	{ where: [{ field: "tag", op: "in", value: [] }] },
	{ where: [{ field: "score", op: "gt", value: 2.5 }] },
	{ where: [{ field: "score", op: "gte", value: 3 }] },
	{ where: [{ field: "score", op: "lt", value: 100 }] },
	{ where: [{ field: "score", op: "lte", value: 3 }] },
	{ where: [{ field: "tag", op: "gte", value: "x" }] },
	{
		where: [
			{ field: "score", op: "gt", value: 1 },
			{ field: "tag", op: "eq", value: "x" },
		],
	},
	{ sort: [{ field: "name", direction: "desc" }], limit: 0 },
	{ sort: [{ field: "name", direction: "desc" }], limit: 2, offset: 1 },
];

describe("PostgresStore", () => {
	let db: PGlite;
	let store: PostgresStore;

	beforeAll(async () => {
		db = new PGlite();
		await db.waitReady;
	});

	afterAll(async () => {
		await db.close();
	});

	beforeEach(async () => {
		await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
		store = new PostgresStore({ client: db });
		await store.connect();
	});

	afterEach(async () => {
		await store.disconnect();
	});

	runStoreContract(() => store);

	it("reports its kind", () => {
		expect(store.kind).toBe("postgres");
	});

	it("creates tables and indexes idempotently", async () => {
		await store.insert("components", component("keep"));
		await expect(store.connect()).resolves.toBeUndefined();
		await expect(store.get("components", "keep")).resolves.toEqual(
			component("keep"),
		);

		const { rows } = await db.query<{ indexname: string; indexdef: string }>(
			"SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ic_members' ORDER BY indexname",
		);
		expect(rows.map((row) => row.indexname)).toEqual([
			"ic_members_email_idx",
			"ic_members_pkey",
		]);
		expect(rows[0]?.indexdef).toContain("CREATE UNIQUE INDEX");
		expect(rows[0]?.indexdef).toContain("(data -> 'email'::text)");
	});

	it("stores the whole document as jsonb keyed by id", async () => {
		await store.insert("components", component("raw", { order: 7 }));
		const { rows } = await db.query<{ id: string; data: Component }>(
			"SELECT id, data FROM ic_components",
		);
		expect(rows).toEqual([{ id: "raw", data: component("raw", { order: 7 }) }]);
	});

	it("uses a custom table prefix", async () => {
		const custom = new PostgresStore({ client: db, tablePrefix: "custom_" });
		await custom.connect();
		await custom.insert("components", component("pre"));
		const { rows } = await db.query<{ id: string }>(
			"SELECT id FROM custom_components",
		);
		expect(rows).toEqual([{ id: "pre" }]);
		await expect(store.get("components", "pre")).resolves.toBeUndefined();

		const bare = new PostgresStore({ client: db, tablePrefix: "" });
		await bare.connect();
		await bare.insert("members", {
			id: "m1",
			email: "a@example.com",
			name: "A",
			role: "admin",
			passwordHash: "hash",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await expect(db.query("SELECT id FROM members")).resolves.toMatchObject({
			rows: [{ id: "m1" }],
		});
	});

	it("rejects an invalid table prefix", () => {
		expect(
			() => new PostgresStore({ client: db, tablePrefix: "bad-prefix" }),
		).toThrow('Invalid table prefix "bad-prefix"');
		expect(() => new PostgresStore({ client: db, tablePrefix: "1x" })).toThrow(
			Error,
		);
	});

	it("rejects field names that are not plain identifiers", async () => {
		const injection = "status' = 'x' OR '1'='1";
		const where = store.find("components", {
			where: [{ field: injection, op: "eq", value: "x" }],
		});
		await expect(where).rejects.toThrow(`Invalid field name "${injection}"`);
		await expect(where).rejects.not.toBeInstanceOf(ConflictError);
		await expect(
			store.find("components", { sort: [{ field: "a.b" }] }),
		).rejects.toThrow('Invalid field name "a.b"');
		await expect(
			store.count("components", {
				where: [{ field: "", op: "eq", value: 1 }],
			}),
		).rejects.toThrow("Invalid field name");
	});

	it("only interpolates known collection names", async () => {
		await expect(
			store.find("ic_components; DROP TABLE x" as CollectionName),
		).rejects.toThrow('Unknown collection "ic_components; DROP TABLE x"');
	});

	it("matches MemoryStore semantics for nulls, missing fields and pagination", async () => {
		const memory = new MemoryStore();
		for (const doc of PARITY_DOCS) {
			await memory.insert("components", doc);
			await store.insert("components", doc);
		}
		const ids = (docs: { id: string }[]) => docs.map((doc) => doc.id);
		for (const query of PARITY_QUERIES) {
			const expected = ids(await memory.find("components", query));
			const actual = ids(await store.find("components", query));
			const sorted = query.sort ? actual : actual.sort();
			expect(sorted, JSON.stringify(query)).toEqual(
				query.sort ? expected : expected.sort(),
			);
			await expect(store.count("components", query)).resolves.toBe(
				await memory.count("components", query),
			);
		}
	});

	it("deletes many honoring sort, limit and offset like find", async () => {
		for (const doc of PARITY_DOCS) {
			await store.insert("components", doc);
		}
		await expect(
			store.deleteMany("components", {
				sort: [{ field: "name" }],
				limit: 2,
				offset: 1,
			}),
		).resolves.toBe(2);
		const remaining = await store.find("components", {
			sort: [{ field: "name" }],
		});
		expect(remaining.map((doc) => doc.id)).toEqual(["p1", "p4", "p5"]);
		await expect(store.deleteMany("components", {})).resolves.toBe(3);
	});

	it("drops undefined fields instead of storing them", async () => {
		await store.insert(
			"components",
			component("u", { description: undefined }),
		);
		const doc = await store.get("components", "u");
		expect(doc).toEqual(component("u"));
		expect(doc && "description" in doc).toBe(false);
	});

	it("maps unique violations to ConflictError", async () => {
		await store.insert("components", component("dup"));
		await expect(
			store.insert("components", component("dup")),
		).rejects.toThrowError(
			new ConflictError(
				"A components record with that id or unique field already exists",
			),
		);
	});

	it.each([
		[
			"a different error code",
			Object.assign(new Error("boom"), { code: "42P01" }),
		],
		["no error code", new Error("plain failure")],
		["a non-Error value", "string failure"],
	])("rethrows errors with %s unchanged", async (_label, error) => {
		const failing: SqlClient = { query: () => Promise.reject(error) };
		const broken = new PostgresStore({ client: failing });
		await expect(broken.insert("components", component("x"))).rejects.toBe(
			error,
		);
		await expect(broken.update("components", component("x"))).rejects.toBe(
			error,
		);
		await expect(broken.ping()).rejects.toBe(error);
	});

	it("never ends an injected client", async () => {
		const injected: SqlClient = {
			query: vi.fn(async () => ({ rows: [] })),
			end: vi.fn(async () => {}),
		};
		await new PostgresStore({ client: injected }).disconnect();
		expect(injected.end).not.toHaveBeenCalled();
	});

	it("creates a pg pool from the connection string and ends it on disconnect", async () => {
		const end = vi.spyOn(pg.Pool.prototype, "end");
		try {
			const owned = new PostgresStore({
				connectionString: "postgres://user:secret@127.0.0.1:1/nowhere",
			});
			// The pool is lazy: nothing listens on port 1, so only a query fails.
			await expect(owned.ping()).rejects.toThrow();
			await owned.disconnect();
			expect(end).toHaveBeenCalledTimes(1);
		} finally {
			end.mockRestore();
		}
	});
});
