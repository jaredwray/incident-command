import {
	type Collection,
	type Db,
	type Document,
	type Filter,
	MongoClient,
} from "mongodb";
import { ConflictError } from "../errors";
import {
	COLLECTIONS,
	type CollectionName,
	type Condition,
	type Doc,
	type DocumentStore,
	INDEXES,
	type Query,
	type SortSpec,
	type UpdateOptions,
} from "./types";

export interface MongoStoreOptions {
	/** Used to create a `MongoClient` when no `client` is given. */
	url?: string;
	/** Bring your own client. It is owned by the caller and never closed by `disconnect()`. */
	client?: MongoClient;
	/** Database name. Defaults to the database in the connection string. */
	dbName?: string;
	/** Prefix for every collection name. Defaults to none. */
	collectionPrefix?: string;
	/**
	 * Keep one connected client (default `true`). Set to `false` to open a
	 * client for each operation and close it after. Cloudflare Workers need
	 * this because a socket cannot outlive the request that opened it. Ignored
	 * when a `client` is given.
	 */
	pool?: boolean;
}

type StoredDoc = Document & { _id: string };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DUPLICATE_KEY = 11000;
/** Never persist `undefined` as `null`, whatever the client's defaults are. */
const WRITE_OPTIONS = { ignoreUndefined: true } as const;

/** Maps a document field to its Mongo path. `id` is stored as `_id` too, so use that index. */
function path(field: string): string {
	if (!IDENTIFIER.test(field)) {
		throw new Error(`Invalid field name "${field}"`);
	}
	return field === "id" ? "_id" : field;
}

function compileCondition(condition: Condition): Filter<StoredDoc> {
	const key = path(condition.field);
	switch (condition.op) {
		case "ne":
			// `$ne: null` would also exclude missing fields; only explicit nulls differ from null.
			return condition.value === null
				? { [key]: { $not: { $type: "null" } } }
				: { [key]: { $ne: condition.value } };
		case "in":
			// `$in: [null]` would also match missing fields; require the field to exist.
			return condition.value.includes(null)
				? { [key]: { $in: [...condition.value], $exists: true } }
				: { [key]: { $in: [...condition.value] } };
		default:
			// `$eq: null` matches missing or null fields, as the contract requires.
			return { [key]: { [`$${condition.op}`]: condition.value } };
	}
}

function compileFilter(query: Query | undefined): Filter<StoredDoc> {
	const clauses = (query?.where ?? []).map(compileCondition);
	return clauses.length === 0 ? {} : { $and: clauses };
}

function compileSort(sort: readonly SortSpec[] = []): Record<string, 1 | -1> {
	return Object.fromEntries(
		sort.map((spec) => [path(spec.field), spec.direction === "desc" ? -1 : 1]),
	);
}

function toStored(doc: { id: string }): StoredDoc {
	return { _id: doc.id, ...doc };
}

function isDuplicateKey(error: unknown): boolean {
	return (
		error instanceof Error && "code" in error && error.code === DUPLICATE_KEY
	);
}

/**
 * MongoDB store. Each collection maps to a Mongo collection whose documents
 * use the record id as `_id`; `_id` is stripped from everything read back.
 */
export class MongoStore implements DocumentStore {
	readonly kind = "mongo";
	/** The shared client. Unset when the store opens a client per operation. */
	private readonly client?: MongoClient;
	/** The shared client again, only when the adapter created it and must connect and close it. */
	private readonly owned?: MongoClient;
	private readonly url?: string;
	private readonly dbName?: string;
	private readonly prefix: string;

	constructor(options: MongoStoreOptions = {}) {
		if (!options.client && !options.url) {
			throw new Error("MongoStore requires a url or a client");
		}
		this.url = options.url;
		this.dbName = options.dbName;
		this.prefix = options.collectionPrefix ?? "";
		if (options.client) {
			this.client = options.client;
		} else if (options.pool !== false) {
			this.owned = new MongoClient(options.url as string);
			this.client = this.owned;
		}
	}

	/**
	 * Runs `fn` against the database. With a shared client this is direct;
	 * without one, a client is opened for this call and closed after it.
	 */
	private async run<T>(fn: (db: Db) => Promise<T>): Promise<T> {
		if (this.client) {
			return fn(this.client.db(this.dbName));
		}
		const client = new MongoClient(this.url as string);
		try {
			await client.connect();
			return await fn(client.db(this.dbName));
		} finally {
			await client.close();
		}
	}

	private collection(db: Db, name: CollectionName): Collection<StoredDoc> {
		if (!COLLECTIONS.includes(name)) {
			throw new Error(`Unknown collection "${name}"`);
		}
		return db.collection<StoredDoc>(`${this.prefix}${name}`);
	}

	private conflict(error: unknown, collection: CollectionName): unknown {
		return isDuplicateKey(error)
			? new ConflictError(
					`A ${collection} record with that id or unique field already exists`,
				)
			: error;
	}

	/** Runs the query with `find` semantics, returning the given projection. */
	private async select<T extends Document>(
		db: Db,
		collection: CollectionName,
		query: Query | undefined,
		projection: Document,
	): Promise<T[]> {
		// Mongo treats `limit: 0` as "no limit"; the contract treats it as zero rows.
		if (query?.limit === 0) {
			return [];
		}
		return this.collection(db, collection)
			.find<T>(compileFilter(query), {
				projection,
				sort: compileSort(query?.sort),
				skip: query?.offset,
				limit: query?.limit,
			})
			.toArray();
	}

	/** Connects (when the client is ours) and creates every index. Safe to call on every boot. */
	async connect(): Promise<void> {
		await this.owned?.connect();
		await this.run(async (db) => {
			for (const collection of COLLECTIONS) {
				const indexes = INDEXES[collection];
				if (indexes.length === 0) {
					continue;
				}
				await this.collection(db, collection).createIndexes(
					indexes.map((index) => ({
						key: { [index.field]: 1 },
						unique: index.unique === true,
					})),
				);
			}
		});
	}

	async disconnect(): Promise<void> {
		await this.owned?.close();
	}

	async ping(): Promise<void> {
		await this.run((db) => db.command({ ping: 1 }));
	}

	async find<C extends CollectionName>(
		collection: C,
		query?: Query,
	): Promise<Doc<C>[]> {
		return this.run((db) =>
			this.select<Doc<C>>(db, collection, query, { _id: 0 }),
		);
	}

	async get<C extends CollectionName>(
		collection: C,
		id: string,
	): Promise<Doc<C> | undefined> {
		const doc = await this.run((db) =>
			this.collection(db, collection).findOne<Doc<C>>(
				{ _id: id },
				{ projection: { _id: 0 } },
			),
		);
		return doc ?? undefined;
	}

	async count<C extends CollectionName>(
		collection: C,
		query?: Query,
	): Promise<number> {
		return this.run((db) =>
			this.collection(db, collection).countDocuments(compileFilter(query)),
		);
	}

	async insert<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
	): Promise<Doc<C>> {
		try {
			await this.run((db) =>
				this.collection(db, collection).insertOne(toStored(doc), WRITE_OPTIONS),
			);
			return structuredClone(doc);
		} catch (error) {
			throw this.conflict(error, collection);
		}
	}

	async update<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
		options?: UpdateOptions,
	): Promise<Doc<C> | undefined> {
		try {
			const result = await this.run((db) =>
				this.collection(db, collection).replaceOne(
					{ $and: [{ _id: doc.id }, compileFilter(options)] },
					toStored(doc),
					WRITE_OPTIONS,
				),
			);
			return result.matchedCount === 0 ? undefined : structuredClone(doc);
		} catch (error) {
			throw this.conflict(error, collection);
		}
	}

	async delete<C extends CollectionName>(
		collection: C,
		id: string,
	): Promise<boolean> {
		const result = await this.run((db) =>
			this.collection(db, collection).deleteOne({ _id: id }),
		);
		return result.deletedCount === 1;
	}

	async deleteMany<C extends CollectionName>(
		collection: C,
		query: Query,
	): Promise<number> {
		return this.run(async (db) => {
			const target = this.collection(db, collection);
			if (query.limit === undefined && query.offset === undefined) {
				const result = await target.deleteMany(compileFilter(query));
				return result.deletedCount;
			}
			// Mongo cannot delete a sorted/paginated window directly: select the ids first.
			const ids = (
				await this.select<{ _id: string }>(db, collection, query, { _id: 1 })
			).map((doc) => doc._id);
			const result = await target.deleteMany({ _id: { $in: ids } });
			return result.deletedCount;
		});
	}
}
