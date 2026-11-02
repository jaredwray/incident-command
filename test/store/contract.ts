import type { Component, Member } from "@/lib/domain/types";
import { ConflictError } from "@/lib/errors";
import type { DocumentStore } from "@/lib/store/types";

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

function member(id: string, email: string): Member {
	return {
		id,
		email,
		name: id,
		role: "admin",
		passwordHash: "hash",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

/**
 * Shared behavioral contract every DocumentStore adapter must satisfy.
 * Call inside a describe block; `getStore` must return a connected, empty store.
 */
export function runStoreContract(getStore: () => DocumentStore) {
	it("connects, pings and reports a kind", async () => {
		const store = getStore();
		await expect(store.ping()).resolves.toBeUndefined();
		expect(typeof store.kind).toBe("string");
	});

	it("inserts and gets documents (round-tripping nested data)", async () => {
		const store = getStore();
		const doc = component("c1", { description: "hello", group: "API" });
		await expect(store.insert("components", doc)).resolves.toEqual(doc);
		await expect(store.get("components", "c1")).resolves.toEqual(doc);
		await expect(store.get("components", "missing")).resolves.toBeUndefined();

		await store.insert("incidents", {
			id: "i1",
			kind: "incident",
			title: "Down",
			status: "investigating",
			impact: "major",
			componentIds: ["c1", "c2"],
			updates: [
				{
					id: "u1",
					status: "investigating",
					message: "Looking",
					author: { type: "agent", id: "a1", name: "Bot" },
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			],
			startedAt: "2026-01-01T00:00:00.000Z",
			createdBy: { type: "agent", id: "a1", name: "Bot" },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const incident = await store.get("incidents", "i1");
		expect(incident?.componentIds).toEqual(["c1", "c2"]);
		expect(incident?.updates[0]?.author.name).toBe("Bot");
	});

	it("rejects duplicate ids with ConflictError", async () => {
		const store = getStore();
		await store.insert("components", component("dup"));
		await expect(
			store.insert("components", component("dup")),
		).rejects.toBeInstanceOf(ConflictError);
	});

	it("enforces unique indexes on insert and update", async () => {
		const store = getStore();
		await store.insert("members", member("m1", "a@example.com"));
		await store.insert("members", member("m2", "b@example.com"));
		await expect(
			store.insert("members", member("m3", "a@example.com")),
		).rejects.toBeInstanceOf(ConflictError);
		await expect(
			store.update("members", member("m2", "a@example.com")),
		).rejects.toBeInstanceOf(ConflictError);
		// updating a document with its own unique value is fine
		await expect(
			store.update("members", {
				...member("m1", "a@example.com"),
				name: "New",
			}),
		).resolves.toMatchObject({ name: "New" });
	});

	it("updates existing documents and returns undefined for missing ones", async () => {
		const store = getStore();
		await store.insert("components", component("u1"));
		const updated = component("u1", {
			name: "Renamed",
			status: "major_outage",
		});
		await expect(store.update("components", updated)).resolves.toEqual(updated);
		await expect(store.get("components", "u1")).resolves.toEqual(updated);
		await expect(
			store.update("components", component("nope")),
		).resolves.toBeUndefined();
	});

	it("supports conditional (optimistic) updates", async () => {
		const store = getStore();
		await store.insert("components", component("cas", { order: 1 }));
		const stale = await store.update(
			"components",
			component("cas", { name: "Stale", order: 2 }),
			{ where: [{ field: "order", op: "eq", value: 5 }] },
		);
		expect(stale).toBeUndefined();
		expect((await store.get("components", "cas"))?.name).toBe("Component cas");
		const fresh = await store.update(
			"components",
			component("cas", { name: "Fresh", order: 2 }),
			{ where: [{ field: "order", op: "eq", value: 1 }] },
		);
		expect(fresh?.name).toBe("Fresh");
		// a condition on a missing field matches with eq null
		await expect(
			store.update(
				"components",
				component("cas", { name: "Again", order: 3 }),
				{
					where: [{ field: "group", op: "eq", value: null }],
				},
			),
		).resolves.toMatchObject({ name: "Again" });
		await expect(
			store.update("components", component("missing"), {
				where: [{ field: "order", op: "eq", value: 0 }],
			}),
		).resolves.toBeUndefined();
	});

	it("removes optional fields when a document is replaced", async () => {
		const store = getStore();
		await store.insert("components", component("opt", { description: "x" }));
		await store.update("components", component("opt"));
		const doc = await store.get("components", "opt");
		expect(doc?.description).toBeUndefined();
	});

	it("deletes documents", async () => {
		const store = getStore();
		await store.insert("components", component("d1"));
		await expect(store.delete("components", "d1")).resolves.toBe(true);
		await expect(store.delete("components", "d1")).resolves.toBe(false);
		await expect(store.get("components", "d1")).resolves.toBeUndefined();
	});

	describe("queries", () => {
		async function seed(store: DocumentStore) {
			await store.insert(
				"components",
				component("a", {
					order: 3,
					status: "operational",
					group: "API",
					createdAt: "2026-01-03T00:00:00.000Z",
				}),
			);
			await store.insert(
				"components",
				component("b", {
					order: 1,
					status: "major_outage",
					createdAt: "2026-01-01T00:00:00.000Z",
				}),
			);
			await store.insert(
				"components",
				component("c", {
					order: 2,
					status: "partial_outage",
					group: "Web",
					createdAt: "2026-01-02T00:00:00.000Z",
				}),
			);
			await store.insert(
				"components",
				component("d", {
					order: 10,
					status: "operational",
					hidden: true,
					createdAt: "2026-01-04T00:00:00.000Z",
				}),
			);
		}
		const ids = (docs: { id: string }[]) => docs.map((doc) => doc.id);

		it("returns everything with no query", async () => {
			const store = getStore();
			await seed(store);
			expect(ids(await store.find("components")).sort()).toEqual([
				"a",
				"b",
				"c",
				"d",
			]);
			await expect(store.count("components")).resolves.toBe(4);
		});

		it("filters with eq / ne / in", async () => {
			const store = getStore();
			await seed(store);
			const eq = await store.find("components", {
				where: [{ field: "status", op: "eq", value: "operational" }],
				sort: [{ field: "id" }],
			});
			expect(ids(eq)).toEqual(["a", "d"]);
			const bool = await store.find("components", {
				where: [{ field: "hidden", op: "eq", value: true }],
			});
			expect(ids(bool)).toEqual(["d"]);
			const ne = await store.find("components", {
				where: [{ field: "status", op: "ne", value: "operational" }],
				sort: [{ field: "id" }],
			});
			expect(ids(ne)).toEqual(["b", "c"]);
			const isin = await store.find("components", {
				where: [{ field: "id", op: "in", value: ["a", "c", "zzz"] }],
				sort: [{ field: "id" }],
			});
			expect(ids(isin)).toEqual(["a", "c"]);
			const empty = await store.find("components", {
				where: [{ field: "id", op: "in", value: [] }],
			});
			expect(empty).toEqual([]);
		});

		it("treats eq null as missing and ne as including missing", async () => {
			const store = getStore();
			await seed(store);
			const missing = await store.find("components", {
				where: [{ field: "group", op: "eq", value: null }],
				sort: [{ field: "id" }],
			});
			expect(ids(missing)).toEqual(["b", "d"]);
			const notApi = await store.find("components", {
				where: [{ field: "group", op: "ne", value: "API" }],
				sort: [{ field: "id" }],
			});
			expect(ids(notApi)).toEqual(["b", "c", "d"]);
			const ranged = await store.find("components", {
				where: [{ field: "group", op: "gte", value: "A" }],
				sort: [{ field: "id" }],
			});
			expect(ids(ranged)).toEqual(["a", "c"]);
		});

		it("filters with numeric and string range operators", async () => {
			const store = getStore();
			await seed(store);
			const gt = await store.find("components", {
				where: [{ field: "order", op: "gt", value: 2 }],
				sort: [{ field: "order" }],
			});
			expect(ids(gt)).toEqual(["a", "d"]);
			const gte = await store.find("components", {
				where: [{ field: "order", op: "gte", value: 2 }],
				sort: [{ field: "order" }],
			});
			expect(ids(gte)).toEqual(["c", "a", "d"]);
			const lt = await store.find("components", {
				where: [{ field: "order", op: "lt", value: 3 }],
				sort: [{ field: "order" }],
			});
			expect(ids(lt)).toEqual(["b", "c"]);
			const lte = await store.find("components", {
				where: [
					{ field: "createdAt", op: "lte", value: "2026-01-02T00:00:00.000Z" },
				],
				sort: [{ field: "createdAt" }],
			});
			expect(ids(lte)).toEqual(["b", "c"]);
			const between = await store.find("components", {
				where: [
					{ field: "createdAt", op: "gt", value: "2026-01-01T00:00:00.000Z" },
					{ field: "createdAt", op: "lt", value: "2026-01-04T00:00:00.000Z" },
				],
				sort: [{ field: "createdAt", direction: "desc" }],
			});
			expect(ids(between)).toEqual(["a", "c"]);
		});

		it("sorts numerically (not lexically), by multiple keys, and paginates", async () => {
			const store = getStore();
			await seed(store);
			expect(
				ids(await store.find("components", { sort: [{ field: "order" }] })),
			).toEqual(["b", "c", "a", "d"]);
			expect(
				ids(
					await store.find("components", {
						sort: [{ field: "order", direction: "desc" }],
					}),
				),
			).toEqual(["d", "a", "c", "b"]);
			expect(
				ids(
					await store.find("components", {
						sort: [{ field: "status" }, { field: "order", direction: "desc" }],
					}),
				),
			).toEqual(["b", "d", "a", "c"]);
			expect(
				ids(
					await store.find("components", {
						sort: [{ field: "order" }],
						limit: 2,
					}),
				),
			).toEqual(["b", "c"]);
			expect(
				ids(
					await store.find("components", {
						sort: [{ field: "order" }],
						limit: 2,
						offset: 1,
					}),
				),
			).toEqual(["c", "a"]);
			expect(
				ids(
					await store.find("components", {
						sort: [{ field: "order" }],
						offset: 3,
					}),
				),
			).toEqual(["d"]);
		});

		it("counts with a filter, ignoring limit and offset", async () => {
			const store = getStore();
			await seed(store);
			await expect(
				store.count("components", {
					where: [{ field: "hidden", op: "eq", value: false }],
					limit: 1,
					offset: 1,
				}),
			).resolves.toBe(3);
		});

		it("deletes many by query", async () => {
			const store = getStore();
			await seed(store);
			await expect(
				store.deleteMany("components", {
					where: [{ field: "status", op: "eq", value: "operational" }],
				}),
			).resolves.toBe(2);
			expect(
				ids(await store.find("components", { sort: [{ field: "id" }] })),
			).toEqual(["b", "c"]);
			await expect(
				store.deleteMany("components", {
					where: [{ field: "status", op: "eq", value: "nothing" }],
				}),
			).resolves.toBe(0);
		});

		it("keeps collections isolated", async () => {
			const store = getStore();
			await seed(store);
			await expect(store.count("incidents")).resolves.toBe(0);
			await expect(store.get("incidents", "a")).resolves.toBeUndefined();
		});
	});
}
