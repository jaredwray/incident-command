import { Collection, MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Component } from "@/lib/domain/types";
import { ConflictError } from "@/lib/errors";
import { MemoryStore } from "@/lib/store/memory";
import { MongoStore } from "@/lib/store/mongo";
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
	{ where: [{ field: "id", op: "in", value: ["p2", "p4", "nope"] }] },
	{ where: [{ field: "id", op: "ne", value: "p1" }] },
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
	{ sort: [{ field: "id", direction: "desc" }], offset: 3 },
];

describe("MongoStore", () => {
	let server: MongoMemoryServer;
	let client: MongoClient;
	let store: MongoStore;
	let dbName: string;
	let counter = 0;

	beforeAll(async () => {
		server = await MongoMemoryServer.create();
		client = new MongoClient(server.getUri());
		await client.connect();
	});

	afterAll(async () => {
		await client.close();
		await server.stop();
	});

	beforeEach(async () => {
		counter += 1;
		dbName = `store_test_${counter}`;
		store = new MongoStore({ client, dbName });
		await store.connect();
	});

	afterEach(async () => {
		await store.disconnect();
		await client.db(dbName).dropDatabase();
	});

	runStoreContract(() => store);

	it("reports its kind", () => {
		expect(store.kind).toBe("mongo");
	});

	it("creates indexes idempotently", async () => {
		await store.insert("components", component("keep"));
		await expect(store.connect()).resolves.toBeUndefined();
		await expect(store.get("components", "keep")).resolves.toEqual(
			component("keep"),
		);

		const indexes = await client
			.db(dbName)
			.collection("subscribers")
			.listIndexes()
			.toArray();
		expect(indexes.map((index) => [index.key, index.unique === true])).toEqual(
			expect.arrayContaining([
				[{ token: 1 }, true],
				[{ target: 1 }, true],
			]),
		);
		const components = await client
			.db(dbName)
			.collection("components")
			.listIndexes()
			.toArray();
		expect(components.find((index) => index.key.order === 1)?.unique).toBe(
			undefined,
		);
	});

	it("stores documents with the id as _id and strips _id on read", async () => {
		await store.insert("components", component("raw", { order: 7 }));
		const raw = await client
			.db(dbName)
			.collection("components")
			.findOne({ _id: "raw" as never });
		expect(raw).toEqual({ _id: "raw", ...component("raw", { order: 7 }) });
		const [found] = await store.find("components");
		expect(found).toEqual(component("raw", { order: 7 }));
		expect(found && "_id" in found).toBe(false);
	});

	it("uses a custom collection prefix", async () => {
		const custom = new MongoStore({
			client,
			dbName,
			collectionPrefix: "custom_",
		});
		await custom.connect();
		await custom.insert("components", component("pre"));
		const raw = await client
			.db(dbName)
			.collection("custom_components")
			.countDocuments();
		expect(raw).toBe(1);
		await expect(store.get("components", "pre")).resolves.toBeUndefined();
		await expect(custom.get("components", "pre")).resolves.toEqual(
			component("pre"),
		);
	});

	it("rejects field names that are not plain identifiers", async () => {
		await expect(
			store.find("components", {
				where: [{ field: "$where", op: "eq", value: "sleep(100)" }],
			}),
		).rejects.toThrow('Invalid field name "$where"');
		await expect(
			store.find("components", { sort: [{ field: "a.b" }] }),
		).rejects.toThrow('Invalid field name "a.b"');
	});

	it("only accepts known collection names", async () => {
		await expect(
			store.find("not_a_collection" as CollectionName),
		).rejects.toThrow('Unknown collection "not_a_collection"');
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
		await expect(store.deleteMany("components", { limit: 0 })).resolves.toBe(0);
		await expect(store.deleteMany("components", { offset: 2 })).resolves.toBe(
			1,
		);
		await expect(store.deleteMany("components", {})).resolves.toBe(2);
	});

	it("drops undefined fields instead of storing them as null", async () => {
		await store.insert(
			"components",
			component("u", { description: undefined }),
		);
		await store.update(
			"components",
			component("u", { name: "Renamed", group: undefined }),
		);
		const doc = await store.get("components", "u");
		expect(doc).toEqual(component("u", { name: "Renamed" }));
		expect(doc && ("description" in doc || "group" in doc)).toBe(false);
	});

	it("maps duplicate key errors to ConflictError", async () => {
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
		["a different error code", Object.assign(new Error("boom"), { code: 121 })],
		["no error code", new Error("plain failure")],
		["a non-Error value", "string failure"],
	])("rethrows errors with %s unchanged", async (_label, error) => {
		const insertOne = vi
			.spyOn(Collection.prototype, "insertOne")
			.mockRejectedValue(error);
		const replaceOne = vi
			.spyOn(Collection.prototype, "replaceOne")
			.mockRejectedValue(error);
		try {
			await expect(store.insert("components", component("x"))).rejects.toBe(
				error,
			);
			await expect(store.update("components", component("x"))).rejects.toBe(
				error,
			);
		} finally {
			insertOne.mockRestore();
			replaceOne.mockRestore();
		}
	});

	it("never connects or closes an injected client", async () => {
		const connect = vi.spyOn(client, "connect");
		const close = vi.spyOn(client, "close");
		try {
			const injected = new MongoStore({ client, dbName });
			await injected.connect();
			await injected.disconnect();
			expect(connect).not.toHaveBeenCalled();
			expect(close).not.toHaveBeenCalled();
			await expect(injected.ping()).resolves.toBeUndefined();
		} finally {
			connect.mockRestore();
			close.mockRestore();
		}
	});

	it("creates, connects and closes its own client from a url", async () => {
		const ownedDb = `${dbName}_owned`;
		const close = vi.spyOn(MongoClient.prototype, "close");
		try {
			// No dbName: the database comes from the connection string.
			const owned = new MongoStore({ url: server.getUri(ownedDb) });
			await owned.connect();
			await owned.ping();
			await owned.insert("components", component("own"));
			await owned.disconnect();
			expect(close).toHaveBeenCalledTimes(1);
		} finally {
			close.mockRestore();
		}
		await expect(
			client.db(ownedDb).collection("components").countDocuments(),
		).resolves.toBe(1);
		await client.db(ownedDb).dropDatabase();
	});

	it("requires a url or a client", () => {
		expect(() => new MongoStore()).toThrow(
			"MongoStore requires a url or a client",
		);
	});
});
