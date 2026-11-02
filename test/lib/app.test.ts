import { createApp, getApp, setApp } from "@/lib/app";
import { loadConfig } from "@/lib/config";
import { CachedStore } from "@/lib/store/cached";
import { createBaseStore, createStore } from "@/lib/store/factory";
import { MemoryStore } from "@/lib/store/memory";
import { FakeNotifier } from "../helpers";

vi.mock("@/lib/store/postgres", () => ({
	PostgresStore: class {
		kind = "postgres";
		constructor(public options: unknown) {}
	},
}));
vi.mock("@/lib/store/mongo", () => ({
	MongoStore: class {
		kind = "mongo";
		constructor(public options: unknown) {}
	},
}));

describe("store factory", () => {
	it("creates the configured adapter", async () => {
		const memory = await createBaseStore(loadConfig({}).store);
		expect(memory).toBeInstanceOf(MemoryStore);
		const postgres = (await createBaseStore(
			loadConfig({
				DATABASE_URL: "postgres://db/x",
				DATABASE_TABLE_PREFIX: "t_",
			}).store,
		)) as unknown as {
			kind: string;
			options: unknown;
		};
		expect(postgres.kind).toBe("postgres");
		expect(postgres.options).toEqual({
			connectionString: "postgres://db/x",
			tablePrefix: "t_",
			pool: true,
		});
		const mongo = (await createBaseStore(
			loadConfig({ DATABASE_URL: "mongodb://db", DATABASE_NAME: "status" })
				.store,
		)) as unknown as {
			kind: string;
			options: unknown;
		};
		expect(mongo.options).toEqual({ url: "mongodb://db", dbName: "status" });
	});

	it("wraps the adapter in the cache", async () => {
		const store = await createStore(loadConfig({ CACHE_TTL: "5s" }));
		expect(store).toBeInstanceOf(CachedStore);
		expect(store.inner).toBeInstanceOf(MemoryStore);
	});
});

describe("app container", () => {
	afterEach(() => {
		setApp(undefined);
		vi.unstubAllEnvs();
	});

	it("creates a fully wired app from env", async () => {
		vi.stubEnv("ADMIN_EMAIL", "root@acme.dev");
		vi.stubEnv("ADMIN_PASSWORD", "password123");
		const app = await createApp();
		expect(app.store.kind).toBe("memory");
		expect(await app.services.members.count()).toBe(1);
		expect(app.notifier.emailEnabled).toBe(false);
	});

	it("accepts injected dependencies", async () => {
		const notifier = new FakeNotifier();
		const store = new CachedStore(new MemoryStore());
		const now = () => new Date("2020-01-01T00:00:00.000Z");
		const app = await createApp({
			config: loadConfig({}),
			store,
			notifier,
			now,
		});
		expect(app.store).toBe(store);
		expect(app.notifier).toBe(notifier);
		expect((await app.services.status.summary()).generatedAt).toBe(
			"2020-01-01T00:00:00.000Z",
		);
	});

	it("memoizes the global app and retries after failures", async () => {
		const first = getApp();
		expect(getApp()).toBe(first);
		await first;

		setApp(undefined);
		vi.stubEnv("CACHE_TTL", "nonsense");
		await expect(getApp()).rejects.toThrow(/Invalid configuration/);
		vi.unstubAllEnvs();
		await expect(getApp()).resolves.toBeDefined();

		const injected = await createApp({
			config: loadConfig({}),
			notifier: new FakeNotifier(),
		});
		setApp(injected);
		await expect(getApp()).resolves.toBe(injected);
	});
});
