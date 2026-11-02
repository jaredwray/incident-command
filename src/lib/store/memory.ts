import { ConflictError } from "../errors";
import { applyQuery, matchesQuery } from "./query";
import {
	type CollectionName,
	type Doc,
	type DocumentStore,
	INDEXES,
	type Query,
	type UpdateOptions,
} from "./types";

/**
 * In-process store. Great for local development, demos and tests.
 * Data is lost when the process restarts.
 */
export class MemoryStore implements DocumentStore {
	readonly kind = "memory";
	private readonly data = new Map<CollectionName, Map<string, unknown>>();

	async connect(): Promise<void> {}

	async disconnect(): Promise<void> {}

	async ping(): Promise<void> {}

	private table<C extends CollectionName>(collection: C): Map<string, Doc<C>> {
		let table = this.data.get(collection);
		if (!table) {
			table = new Map();
			this.data.set(collection, table);
		}
		return table as Map<string, Doc<C>>;
	}

	private assertUnique<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
	): void {
		const record = doc as unknown as Record<string, unknown>;
		for (const index of INDEXES[collection]) {
			if (!index.unique) {
				continue;
			}
			for (const existing of this.table(collection).values()) {
				const other = existing as unknown as Record<string, unknown>;
				if (other.id !== doc.id && other[index.field] === record[index.field]) {
					throw new ConflictError(
						`A ${collection} record with that ${index.field} already exists`,
					);
				}
			}
		}
	}

	async find<C extends CollectionName>(
		collection: C,
		query?: Query,
	): Promise<Doc<C>[]> {
		const rows = this.table(collection).values() as Iterable<
			Doc<C> & Record<string, unknown>
		>;
		return applyQuery(rows, query).map((row) => structuredClone(row));
	}

	async get<C extends CollectionName>(
		collection: C,
		id: string,
	): Promise<Doc<C> | undefined> {
		const doc = this.table(collection).get(id);
		return doc === undefined ? undefined : structuredClone(doc);
	}

	async count<C extends CollectionName>(
		collection: C,
		query?: Query,
	): Promise<number> {
		const { limit: _limit, offset: _offset, ...rest } = query ?? {};
		return (await this.find(collection, rest)).length;
	}

	async insert<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
	): Promise<Doc<C>> {
		const table = this.table(collection);
		if (table.has(doc.id)) {
			throw new ConflictError(
				`A ${collection} record with id "${doc.id}" already exists`,
			);
		}
		this.assertUnique(collection, doc);
		table.set(doc.id, structuredClone(doc));
		return structuredClone(doc);
	}

	async update<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
		options?: UpdateOptions,
	): Promise<Doc<C> | undefined> {
		const table = this.table(collection);
		const existing = table.get(doc.id) as Record<string, unknown> | undefined;
		if (!existing || !matchesQuery(existing, options)) {
			return undefined;
		}
		this.assertUnique(collection, doc);
		table.set(doc.id, structuredClone(doc));
		return structuredClone(doc);
	}

	async delete<C extends CollectionName>(
		collection: C,
		id: string,
	): Promise<boolean> {
		return this.table(collection).delete(id);
	}

	async deleteMany<C extends CollectionName>(
		collection: C,
		query: Query,
	): Promise<number> {
		const matches = await this.find(collection, query);
		for (const doc of matches) {
			this.table(collection).delete(doc.id);
		}
		return matches.length;
	}
}
