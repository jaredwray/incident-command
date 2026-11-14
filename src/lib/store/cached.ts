import { Cacheable, createKeyv, shorthandToMilliseconds } from "cacheable";
import { isAppError, StoreUnavailableError } from "../errors";
import type {
	CollectionName,
	Doc,
	DocumentStore,
	Query,
	ReadOptions,
	UpdateOptions,
} from "./types";

/** Collections served from cache by default: everything the public status page reads. */
export const DEFAULT_CACHED_COLLECTIONS: readonly CollectionName[] = [
	"settings",
	"services",
	"service_status_changes",
	"incidents",
	// The public pages read it to decide whether to offer email subscriptions.
	"notification_channels",
];

export interface CachedStoreOptions {
	/**
	 * How long a cached read is considered fresh (ms or shorthand such as `30s`).
	 * Entries never expire from the cache itself: once stale they are refreshed
	 * from the store, and if the store is offline the stale value keeps being served.
	 */
	ttl?: number | string;
	/** Maximum number of cached reads kept in memory (LRU). */
	maxEntries?: number;
	/** Collections to cache. Everything else always goes to the store. */
	collections?: readonly CollectionName[];
	/** Bring your own cacheable instance (e.g. with a Redis secondary). */
	cache?: Cacheable;
	now?: () => number;
}

export interface StoreHealth {
	online: boolean;
	kind: string;
	lastError?: string;
	lastErrorAt?: string;
	lastOnlineAt?: string;
}

interface CacheEntry<T> {
	value: T;
	version: number;
	freshUntil: number;
}

/**
 * Wraps any `DocumentStore` with a cacheable-backed read cache that keeps
 * serving the last known good data when the underlying store goes offline.
 *
 * - Reads of cached collections are served from cache while fresh.
 * - Stale entries are refreshed from the store; if the store fails, the stale
 *   entry is returned instead of an error (no TTL while offline).
 * - Writes go straight to the store and mark that collection's entries stale
 *   without discarding them, so they remain available as an offline fallback.
 */
export class CachedStore implements DocumentStore {
	readonly inner: DocumentStore;
	readonly cache: Cacheable;
	private readonly ttl: number;
	private readonly collections: ReadonlySet<CollectionName>;
	private readonly versions = new Map<CollectionName, number>();
	private readonly now: () => number;
	private state: StoreHealth;

	constructor(inner: DocumentStore, options: CachedStoreOptions = {}) {
		this.inner = inner;
		this.ttl = shorthandToMilliseconds(options.ttl ?? "30s") as number;
		this.collections = new Set(
			options.collections ?? DEFAULT_CACHED_COLLECTIONS,
		);
		this.cache =
			options.cache ??
			new Cacheable({
				primary: createKeyv({ lruSize: options.maxEntries ?? 5000 }),
			});
		this.now = options.now ?? Date.now;
		this.state = { online: true, kind: inner.kind };
	}

	get kind(): string {
		return this.inner.kind;
	}

	get health(): StoreHealth {
		return { ...this.state };
	}

	async connect(): Promise<void> {
		await this.track(() => this.inner.connect());
	}

	async disconnect(): Promise<void> {
		await this.inner.disconnect();
		await this.cache.disconnect();
	}

	async ping(): Promise<void> {
		await this.track(() => this.inner.ping());
	}

	find<C extends CollectionName>(
		collection: C,
		query?: Query,
		options?: ReadOptions,
	): Promise<Doc<C>[]> {
		return this.read(collection, ["find", query ?? {}], options, () =>
			this.inner.find(collection, query),
		);
	}

	get<C extends CollectionName>(
		collection: C,
		id: string,
		options?: ReadOptions,
	): Promise<Doc<C> | undefined> {
		return this.read(collection, ["get", id], options, () =>
			this.inner.get(collection, id),
		);
	}

	count<C extends CollectionName>(
		collection: C,
		query?: Query,
		options?: ReadOptions,
	): Promise<number> {
		return this.read(collection, ["count", query ?? {}], options, () =>
			this.inner.count(collection, query),
		);
	}

	insert<C extends CollectionName>(collection: C, doc: Doc<C>) {
		return this.write(collection, () => this.inner.insert(collection, doc));
	}

	update<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
		options?: UpdateOptions,
	) {
		return this.write(collection, () =>
			this.inner.update(collection, doc, options),
		);
	}

	delete<C extends CollectionName>(collection: C, id: string) {
		return this.write(collection, () => this.inner.delete(collection, id));
	}

	deleteMany<C extends CollectionName>(collection: C, query: Query) {
		return this.write(collection, () =>
			this.inner.deleteMany(collection, query),
		);
	}

	/** Marks every cached read stale (they remain available as an offline fallback). */
	invalidate(collection?: CollectionName): void {
		const targets = collection ? [collection] : [...this.collections];
		for (const name of targets) {
			this.versions.set(name, this.version(name) + 1);
		}
	}

	private version(collection: CollectionName): number {
		return this.versions.get(collection) ?? 0;
	}

	private async read<T>(
		collection: CollectionName,
		key: unknown[],
		options: ReadOptions | undefined,
		loader: () => Promise<T>,
	): Promise<T> {
		if (!this.collections.has(collection) || options?.consistent) {
			return this.track(loader);
		}
		const cacheKey = `${collection}:${JSON.stringify(key)}`;
		const version = this.version(collection);
		const entry = await this.cache.get<CacheEntry<T>>(cacheKey);
		if (entry && entry.version === version && entry.freshUntil > this.now()) {
			return structuredClone(entry.value);
		}
		try {
			const value = await this.track(loader);
			await this.cache.set(cacheKey, {
				value: structuredClone(value),
				version,
				freshUntil: this.now() + this.ttl,
			} satisfies CacheEntry<T>);
			return value;
		} catch (error) {
			if (entry && error instanceof StoreUnavailableError) {
				return structuredClone(entry.value);
			}
			throw error;
		}
	}

	private async write<T>(
		collection: CollectionName,
		operation: () => Promise<T>,
	): Promise<T> {
		const result = await this.track(operation);
		this.invalidate(collection);
		return result;
	}

	/** Runs a store operation and records whether the store is reachable. */
	private async track<T>(operation: () => Promise<T>): Promise<T> {
		try {
			const result = await operation();
			this.state = {
				...this.state,
				online: true,
				lastOnlineAt: new Date(this.now()).toISOString(),
			};
			return result;
		} catch (error) {
			if (isAppError(error)) {
				throw error;
			}
			this.state = {
				...this.state,
				online: false,
				lastError: error instanceof Error ? error.message : String(error),
				lastErrorAt: new Date(this.now()).toISOString(),
			};
			throw new StoreUnavailableError(error);
		}
	}
}
