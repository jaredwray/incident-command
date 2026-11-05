import { Cacheable } from "cacheable";
import type { Service } from "@/lib/domain/types";
import { ConflictError, StoreUnavailableError } from "@/lib/errors";
import { CachedStore } from "@/lib/store/cached";
import { MemoryStore } from "@/lib/store/memory";
import type { CollectionName, DocumentStore } from "@/lib/store/types";
import { runStoreContract } from "./contract";

/** A memory store that can be "taken offline" and counts reads. */
class FlakyStore extends MemoryStore {
	down = false;
	reads = 0;
	failWith: Error | undefined;

	private guard() {
		if (this.failWith) throw this.failWith;
		if (this.down) throw new Error("connection refused");
	}
	override async ping() {
		this.guard();
	}
	override async connect() {
		this.guard();
	}
	override async find<C extends CollectionName>(
		collection: C,
		query?: Parameters<DocumentStore["find"]>[1],
	) {
		this.guard();
		this.reads++;
		return super.find(collection, query);
	}
	override async get<C extends CollectionName>(collection: C, id: string) {
		this.guard();
		this.reads++;
		return super.get(collection, id);
	}
	override async count<C extends CollectionName>(
		collection: C,
		query?: Parameters<DocumentStore["count"]>[1],
	) {
		this.guard();
		// MemoryStore.count delegates to find(), which counts the read
		return super.count(collection, query);
	}
	override async insert<C extends CollectionName>(
		collection: C,
		doc: Parameters<DocumentStore["insert"]>[1],
	) {
		this.guard();
		return super.insert(collection, doc as never);
	}
}

const service = (id: string, name = id): Service => ({
	id,
	name,
	status: "operational",
	order: 0,
	hidden: false,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("CachedStore", () => {
	describe("contract (cache disabled)", () => {
		let store: CachedStore;
		beforeEach(async () => {
			store = new CachedStore(new MemoryStore(), { ttl: 0 });
			await store.connect();
		});
		runStoreContract(() => store);
	});

	describe("contract (cache enabled)", () => {
		let store: CachedStore;
		beforeEach(async () => {
			store = new CachedStore(new MemoryStore(), { ttl: "1h" });
			await store.connect();
		});
		runStoreContract(() => store);
	});

	let inner: FlakyStore;
	let now: number;
	let store: CachedStore;

	beforeEach(async () => {
		inner = new FlakyStore();
		now = Date.parse("2026-11-02T12:00:00.000Z");
		store = new CachedStore(inner, { ttl: "30s", now: () => now });
		await store.connect();
		await inner.insert("services", service("a"));
	});

	it("exposes the inner kind and health", async () => {
		expect(store.kind).toBe("memory");
		expect(store.health).toMatchObject({
			online: true,
			kind: "memory",
			lastOnlineAt: "2026-11-02T12:00:00.000Z",
		});
	});

	it("serves cached reads while fresh and refreshes when stale", async () => {
		await store.find("services");
		await store.get("services", "a");
		await store.count("services");
		await store.find("services");
		await store.get("services", "a");
		await store.count("services");
		expect(inner.reads).toBe(3);

		now += 31_000;
		await store.find("services");
		expect(inner.reads).toBe(4);
	});

	it("caches distinct queries separately", async () => {
		await store.find("services", { limit: 1 });
		await store.find("services", { limit: 2 });
		await store.find("services");
		expect(inner.reads).toBe(3);
	});

	it("marks entries stale on writes", async () => {
		expect(await store.find("services")).toHaveLength(1);
		await store.insert("services", service("b"));
		expect(await store.find("services")).toHaveLength(2);
		await store.update("services", service("b", "renamed"));
		expect((await store.get("services", "b"))?.name).toBe("renamed");
		await store.delete("services", "b");
		expect(await store.get("services", "b")).toBeUndefined();
		await store.deleteMany("services", {
			where: [{ field: "id", op: "eq", value: "a" }],
		});
		expect(await store.count("services")).toBe(0);
	});

	it("keeps serving the last known data while the store is offline", async () => {
		const fresh = await store.find("services");
		inner.down = true;
		now += 10 * 60_000;
		await expect(store.find("services")).resolves.toEqual(fresh);
		expect(store.health).toMatchObject({
			online: false,
			lastError: "connection refused",
		});

		// even after a write elsewhere bumped the version, stale data is still served
		store.invalidate("services");
		now += 24 * 60 * 60_000;
		await expect(store.find("services")).resolves.toEqual(fresh);

		inner.down = false;
		await store.find("services");
		expect(store.health.online).toBe(true);
	});

	it("throws StoreUnavailableError when offline with nothing cached", async () => {
		inner.down = true;
		await expect(store.get("services", "a")).rejects.toBeInstanceOf(
			StoreUnavailableError,
		);
		await expect(store.ping()).rejects.toBeInstanceOf(StoreUnavailableError);
		await expect(store.insert("services", service("z"))).rejects.toBeInstanceOf(
			StoreUnavailableError,
		);
		expect(store.health.online).toBe(false);
	});

	it("records non-Error failures", async () => {
		inner.failWith = "weird" as unknown as Error;
		await expect(store.ping()).rejects.toBeInstanceOf(StoreUnavailableError);
		expect(store.health.lastError).toBe("weird");
	});

	it("propagates application errors without marking the store offline", async () => {
		await expect(store.insert("services", service("a"))).rejects.toBeInstanceOf(
			ConflictError,
		);
		expect(store.health.online).toBe(true);

		await store.find("services");
		now += 60_000;
		inner.failWith = new ConflictError("nope");
		await expect(store.find("services")).rejects.toBeInstanceOf(ConflictError);
		expect(store.health.online).toBe(true);
	});

	it("bypasses the cache for consistent reads and uncached collections", async () => {
		await store.get("services", "a");
		await store.get("services", "a", { consistent: true });
		expect(inner.reads).toBe(2);
		await store.find("members");
		await store.find("members");
		expect(inner.reads).toBe(4);
	});

	it("returns copies of cached values", async () => {
		const first = await store.get("services", "a");
		if (first) first.name = "mutated";
		const second = await store.get("services", "a");
		expect(second?.name).toBe("a");
		if (second) second.name = "mutated again";
		expect((await store.get("services", "a"))?.name).toBe("a");
	});

	it("invalidates every cached collection at once", async () => {
		await store.find("services");
		await store.find("incidents");
		store.invalidate();
		await store.find("services");
		await store.find("incidents");
		expect(inner.reads).toBe(4);
	});

	it("accepts a custom cache and collection list, and disconnects", async () => {
		const cache = new Cacheable();
		const custom = new CachedStore(inner, { cache, collections: ["members"] });
		await custom.find("members");
		await custom.find("members");
		await custom.find("services");
		await custom.find("services");
		expect(inner.reads).toBe(3);
		expect(custom.cache).toBe(cache);
		await custom.disconnect();
	});

	it("defaults to a 30 second ttl and the real clock", async () => {
		const defaults = new CachedStore(inner);
		await defaults.find("services");
		await defaults.find("services");
		expect(inner.reads).toBe(1);
	});
});
