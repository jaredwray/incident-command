import { Collection, MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Service } from "@/lib/domain/types";
import { ConflictError } from "@/lib/errors";
import { MemoryStore } from "@/lib/store/memory";
import { MongoStore } from "@/lib/store/mongo";
import { runInRequestScope } from "@/lib/store/request-scope";
import type { CollectionName, Query } from "@/lib/store/types";
import { runStoreContract } from "./contract";

function service(id: string, overrides: Partial<Service> = {}): Service {
	return {
		id,
		name: `Service ${id}`,
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
] as unknown as Service[];

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
		await store.insert("services", service("keep"));
		await expect(store.connect()).resolves.toBeUndefined();
		await expect(store.get("services", "keep")).resolves.toEqual(
			service("keep"),
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
		const services = await client
			.db(dbName)
			.collection("services")
			.listIndexes()
			.toArray();
		expect(services.find((index) => index.key.order === 1)?.unique).toBe(
			undefined,
		);
	});

	it("renames the collections and fields of an old components store one time", async () => {
		const legacyDb = `${dbName}_legacy`;
		const raw = client.db(legacyDb);
		await raw.collection("components").insertOne({
			_id: "c1" as never,
			...service("c1", { name: "API" }),
		});
		await raw.collection("components").createIndex({ order: 1 });
		await raw.collection("component_status_changes").insertOne({
			_id: "s1" as never,
			id: "s1",
			componentId: "c1",
			status: "major_outage",
			previousStatus: "operational",
			createdAt: "2026-01-02T00:00:00.000Z",
		});
		await raw
			.collection("component_status_changes")
			.createIndex({ componentId: 1 });
		await raw.collection("incidents").insertOne({
			_id: "i1" as never,
			id: "i1",
			componentIds: ["c1"],
			title: "Down",
		});
		const upgraded = new MongoStore({ client, dbName: legacyDb });
		await upgraded.connect();
		await expect(upgraded.get("services", "c1")).resolves.toEqual(
			service("c1", { name: "API" }),
		);
		await expect(upgraded.find("service_status_changes")).resolves.toEqual([
			{
				id: "s1",
				serviceId: "c1",
				status: "major_outage",
				previousStatus: "operational",
				createdAt: "2026-01-02T00:00:00.000Z",
			},
		]);
		await expect(upgraded.get("incidents", "i1")).resolves.toEqual({
			id: "i1",
			serviceIds: ["c1"],
			title: "Down",
		});
		const names = (await raw.listCollections().toArray())
			.map((info) => info.name)
			.sort();
		expect(names).toEqual([
			"agent_tokens",
			"incidents",
			"invites",
			"members",
			"service_status_changes",
			"services",
			"sessions",
			"subscribers",
		]);
		const indexes = await raw
			.collection("service_status_changes")
			.listIndexes()
			.toArray();
		expect(indexes.map((index) => Object.keys(index.key)[0]).sort()).toEqual([
			"_id",
			"createdAt",
			"serviceId",
		]);
		await expect(upgraded.connect()).resolves.toBeUndefined();
		await expect(upgraded.count("services")).resolves.toBe(1);
		await raw.dropDatabase();
	});

	it("completes a rename that stopped after the first collection", async () => {
		const partialDb = `${dbName}_partial`;
		const raw = client.db(partialDb);
		await raw.collection("services").insertOne({
			_id: "c1" as never,
			...service("c1"),
		});
		await raw.collection("component_status_changes").insertOne({
			_id: "s1" as never,
			id: "s1",
			componentId: "c1",
			status: "major_outage",
			previousStatus: "operational",
			createdAt: "2026-01-02T00:00:00.000Z",
		});
		await raw.collection("incidents").insertOne({
			_id: "i1" as never,
			id: "i1",
			componentIds: ["c1"],
			title: "Down",
		});
		const resumed = new MongoStore({ client, dbName: partialDb });
		await resumed.connect();
		await expect(resumed.find("service_status_changes")).resolves.toEqual([
			{
				id: "s1",
				serviceId: "c1",
				status: "major_outage",
				previousStatus: "operational",
				createdAt: "2026-01-02T00:00:00.000Z",
			},
		]);
		await expect(resumed.get("incidents", "i1")).resolves.toEqual({
			id: "i1",
			serviceIds: ["c1"],
			title: "Down",
		});
		const names = (await raw.listCollections().toArray()).map(
			(info) => info.name,
		);
		expect(names).not.toContain("component_status_changes");
		await raw.dropDatabase();
	});

	it("keeps an old components collection when a services collection exists", async () => {
		const raw = client.db(dbName);
		await raw
			.collection("components")
			.insertOne({ _id: "old" as never, id: "old" });
		await expect(store.connect()).resolves.toBeUndefined();
		await expect(store.get("services", "old")).resolves.toBeUndefined();
		await expect(raw.collection("components").countDocuments()).resolves.toBe(
			1,
		);
	});

	it("stores documents with the id as _id and strips _id on read", async () => {
		await store.insert("services", service("raw", { order: 7 }));
		const raw = await client
			.db(dbName)
			.collection("services")
			.findOne({ _id: "raw" as never });
		expect(raw).toEqual({ _id: "raw", ...service("raw", { order: 7 }) });
		const [found] = await store.find("services");
		expect(found).toEqual(service("raw", { order: 7 }));
		expect(found && "_id" in found).toBe(false);
	});

	it("uses a custom collection prefix", async () => {
		const custom = new MongoStore({
			client,
			dbName,
			collectionPrefix: "custom_",
		});
		await custom.connect();
		await custom.insert("services", service("pre"));
		const raw = await client
			.db(dbName)
			.collection("custom_services")
			.countDocuments();
		expect(raw).toBe(1);
		await expect(store.get("services", "pre")).resolves.toBeUndefined();
		await expect(custom.get("services", "pre")).resolves.toEqual(
			service("pre"),
		);
	});

	it("rejects field names that are not plain identifiers", async () => {
		await expect(
			store.find("services", {
				where: [{ field: "$where", op: "eq", value: "sleep(100)" }],
			}),
		).rejects.toThrow('Invalid field name "$where"');
		await expect(
			store.find("services", { sort: [{ field: "a.b" }] }),
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
			await memory.insert("services", doc);
			await store.insert("services", doc);
		}
		const ids = (docs: { id: string }[]) => docs.map((doc) => doc.id);
		for (const query of PARITY_QUERIES) {
			const expected = ids(await memory.find("services", query));
			const actual = ids(await store.find("services", query));
			const sorted = query.sort ? actual : actual.sort();
			expect(sorted, JSON.stringify(query)).toEqual(
				query.sort ? expected : expected.sort(),
			);
			await expect(store.count("services", query)).resolves.toBe(
				await memory.count("services", query),
			);
		}
	});

	it("deletes many honoring sort, limit and offset like find", async () => {
		for (const doc of PARITY_DOCS) {
			await store.insert("services", doc);
		}
		await expect(
			store.deleteMany("services", {
				sort: [{ field: "name" }],
				limit: 2,
				offset: 1,
			}),
		).resolves.toBe(2);
		const remaining = await store.find("services", {
			sort: [{ field: "name" }],
		});
		expect(remaining.map((doc) => doc.id)).toEqual(["p1", "p4", "p5"]);
		await expect(store.deleteMany("services", { limit: 0 })).resolves.toBe(0);
		await expect(store.deleteMany("services", { offset: 2 })).resolves.toBe(1);
		await expect(store.deleteMany("services", {})).resolves.toBe(2);
	});

	it("drops undefined fields instead of storing them as null", async () => {
		await store.insert("services", service("u", { description: undefined }));
		await store.update(
			"services",
			service("u", { name: "Renamed", group: undefined }),
		);
		const doc = await store.get("services", "u");
		expect(doc).toEqual(service("u", { name: "Renamed" }));
		expect(doc && ("description" in doc || "group" in doc)).toBe(false);
	});

	it("maps duplicate key errors to ConflictError", async () => {
		await store.insert("services", service("dup"));
		await expect(store.insert("services", service("dup"))).rejects.toThrowError(
			new ConflictError(
				"A services record with that id or unique field already exists",
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
			await expect(store.insert("services", service("x"))).rejects.toBe(error);
			await expect(store.update("services", service("x"))).rejects.toBe(error);
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
			await owned.insert("services", service("own"));
			await owned.disconnect();
			expect(close).toHaveBeenCalledTimes(1);
		} finally {
			close.mockRestore();
		}
		await expect(
			client.db(ownedDb).collection("services").countDocuments(),
		).resolves.toBe(1);
		await client.db(ownedDb).dropDatabase();
	});

	it("opens and closes a client for each operation when pool is false", async () => {
		const perOpDb = `${dbName}_per_op`;
		const connect = vi.spyOn(MongoClient.prototype, "connect");
		const close = vi.spyOn(MongoClient.prototype, "close");
		try {
			const store = new MongoStore({
				url: server.getUri(perOpDb),
				pool: false,
			});
			await store.connect();
			await store.ping();
			await store.insert("services", service("one"));
			await store.insert("services", service("two"));
			await store.update("services", service("one", { order: 1 }));
			await expect(store.get("services", "one")).resolves.toEqual(
				service("one", { order: 1 }),
			);
			await expect(store.find("services")).resolves.toHaveLength(2);
			await expect(store.count("services")).resolves.toBe(2);
			await expect(store.delete("services", "two")).resolves.toBe(true);
			await expect(store.deleteMany("services", { limit: 1 })).resolves.toBe(1);
			// Ten operations, ten clients: each one is closed before the call returns.
			expect(connect).toHaveBeenCalledTimes(10);
			expect(close).toHaveBeenCalledTimes(10);
			await store.disconnect();
			expect(close).toHaveBeenCalledTimes(10);
		} finally {
			connect.mockRestore();
			close.mockRestore();
		}
		const indexes = await client
			.db(perOpDb)
			.collection("subscribers")
			.listIndexes()
			.toArray();
		expect(indexes.some((index) => index.key.token === 1)).toBe(true);
		await client.db(perOpDb).dropDatabase();
	});

	it("opens one client for each request scope when pool is false", async () => {
		const scopedDb = `${dbName}_scoped`;
		const store = new MongoStore({ url: server.getUri(scopedDb), pool: false });
		await store.connect();
		const connect = vi.spyOn(MongoClient.prototype, "connect");
		const close = vi.spyOn(MongoClient.prototype, "close");
		const pending: Promise<unknown>[] = [];
		try {
			const response = await runInRequestScope(
				async () => {
					await store.insert("services", service("one"));
					const [found, all] = await Promise.all([
						store.get("services", "one"),
						store.find("services"),
					]);
					return Response.json({
						found,
						all,
						count: await store.count("services"),
					});
				},
				(promise) => pending.push(promise),
			);
			await expect(response.json()).resolves.toEqual({
				found: service("one"),
				all: [service("one")],
				count: 1,
			});
			await Promise.all(pending);
			// Four operations in one request, one client: closed when the request ends.
			expect(connect).toHaveBeenCalledTimes(1);
			expect(close).toHaveBeenCalledTimes(1);
		} finally {
			connect.mockRestore();
			close.mockRestore();
		}
		await client.db(scopedDb).dropDatabase();
	});

	it("requires a url or a client", () => {
		expect(() => new MongoStore()).toThrow(
			"MongoStore requires a url or a client",
		);
	});
});
