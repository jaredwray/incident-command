import type { Config } from "../config";
import { CachedStore } from "./cached";
import { MemoryStore } from "./memory";
import type { DocumentStore } from "./types";

/** Creates the configured storage adapter. Database drivers load lazily. */
export async function createBaseStore(
	config: Config["store"],
): Promise<DocumentStore> {
	switch (config.kind) {
		case "postgres": {
			const { PostgresStore } = await import("./postgres");
			return new PostgresStore({
				connectionString: config.url,
				tablePrefix: config.tablePrefix,
				pool: config.pool,
			});
		}
		case "mongo": {
			const { MongoStore } = await import("./mongo");
			return new MongoStore({
				url: config.url,
				dbName: config.databaseName,
				pool: config.pool,
			});
		}
		default:
			return new MemoryStore();
	}
}

/** Creates the configured store wrapped in the offline-tolerant cache. */
export async function createStore(config: Config): Promise<CachedStore> {
	return new CachedStore(await createBaseStore(config.store), {
		ttl: config.cache.ttl,
		maxEntries: config.cache.maxEntries,
	});
}
