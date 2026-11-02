import { MemoryStore } from "@/lib/store/memory";
import { runStoreContract } from "./contract";

describe("MemoryStore", () => {
	let store: MemoryStore;

	beforeEach(async () => {
		store = new MemoryStore();
		await store.connect();
	});

	afterEach(async () => {
		await store.disconnect();
	});

	runStoreContract(() => store);

	it("returns copies so callers cannot mutate stored data", async () => {
		await store.insert("components", {
			id: "x",
			name: "X",
			status: "operational",
			order: 0,
			hidden: false,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const doc = await store.get("components", "x");
		if (doc) doc.name = "mutated";
		const [found] = await store.find("components");
		if (found) found.name = "mutated";
		expect((await store.get("components", "x"))?.name).toBe("X");
	});
});
