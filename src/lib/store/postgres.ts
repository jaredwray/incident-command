import pg from "pg";
import { ConflictError } from "../errors";
import {
	COLLECTIONS,
	type CollectionName,
	type Condition,
	type Doc,
	type DocumentStore,
	INDEXES,
	type Query,
	type Scalar,
	type UpdateOptions,
} from "./types";

type Row = Record<string, unknown>;

/**
 * The minimal SQL client surface the adapter needs. Satisfied by `pg.Pool`,
 * `pg.Client` and PGlite.
 */
export interface SqlClient {
	query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
	end?(): Promise<void>;
}

export interface PostgresStoreOptions {
	/** Used to create a `pg.Pool` when no `client` is given (falls back to `PG*` env vars). */
	connectionString?: string;
	/** Bring your own client. It is owned by the caller and never ended by `disconnect()`. */
	client?: SqlClient;
	/** Prefix for every table name. Defaults to `ic_`. */
	tablePrefix?: string;
	/**
	 * Keep a connection pool (default `true`). Set to `false` to open a fresh
	 * connection per query, which Cloudflare Workers (with Hyperdrive) require
	 * because connections cannot be shared between requests.
	 */
	pool?: boolean;
}

/**
 * A client that opens a new connection for every query and closes it after.
 * Meant for runtimes such as Cloudflare Workers, where a pooling proxy like
 * Hyperdrive makes connecting cheap and sockets cannot outlive a request.
 */
export class PerQueryClient implements SqlClient {
	private readonly connectionString?: string;

	constructor(connectionString?: string) {
		this.connectionString = connectionString;
	}

	async query(text: string, params?: unknown[]): Promise<{ rows: Row[] }> {
		const client = new pg.Client({ connectionString: this.connectionString });
		await client.connect();
		try {
			return await client.query(text, params);
		} finally {
			await client.end();
		}
	}
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PREFIX = /^([A-Za-z_][A-Za-z0-9_]*)?$/;
const RANGE_OPERATORS = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
const UNIQUE_VIOLATION = "23505";

/**
 * Quotes a SQL identifier. Names are lowercased first so quoting yields exactly
 * the tables and indexes Postgres creates for the same unquoted names.
 */
function identifier(name: string): string {
	return pg.escapeIdentifier(name.toLowerCase());
}

/**
 * Field names are interpolated into SQL (so expression indexes apply). They
 * must be plain identifiers and are also escaped as a string literal.
 */
function column(field: string): string {
	if (!IDENTIFIER.test(field)) {
		throw new Error(`Invalid field name "${field}"`);
	}
	return `data->${pg.escapeLiteral(field)}`;
}

function compileCondition(condition: Condition, params: unknown[]): string {
	const target = column(condition.field);
	const bind = (value: Scalar) => {
		params.push(JSON.stringify(value));
		return `$${params.length}::jsonb`;
	};
	switch (condition.op) {
		case "eq":
			return condition.value === null
				? `(${target} IS NULL OR ${target} = 'null'::jsonb)`
				: `${target} = ${bind(condition.value)}`;
		case "ne":
			return `${target} IS DISTINCT FROM ${bind(condition.value)}`;
		case "in":
			return condition.value.length === 0
				? "FALSE"
				: `${target} IN (${condition.value.map(bind).join(", ")})`;
		default: {
			// Only compare values of the same JSON type, which also excludes
			// missing fields and explicit nulls like the memory adapter does.
			const value = bind(condition.value);
			return `(jsonb_typeof(${target}) = jsonb_typeof(${value}) AND ${target} ${RANGE_OPERATORS[condition.op]} ${value})`;
		}
	}
}

function compileWhere(query: Query | undefined, params: unknown[]): string {
	const conditions = (query?.where ?? []).map((condition) =>
		compileCondition(condition, params),
	);
	return conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
}

function compileSelect(
	table: string,
	columns: string,
	query: Query | undefined,
	params: unknown[],
): string {
	let sql = `SELECT ${columns} FROM ${table}${compileWhere(query, params)}`;
	if (query?.sort?.length) {
		const order = query.sort.map(
			(spec) =>
				`${column(spec.field)} ${spec.direction === "desc" ? "DESC" : "ASC"}`,
		);
		sql += ` ORDER BY ${order.join(", ")}`;
	}
	if (query?.limit !== undefined) {
		params.push(query.limit);
		sql += ` LIMIT $${params.length}`;
	}
	if (query?.offset !== undefined) {
		params.push(query.offset);
		sql += ` OFFSET $${params.length}`;
	}
	return sql;
}

function isUniqueViolation(error: unknown): boolean {
	return (
		error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION
	);
}

/**
 * PostgreSQL store. Each collection is a `(id TEXT PRIMARY KEY, data JSONB)`
 * table with expression indexes on the indexed fields. Works with `pg` or any
 * compatible client such as PGlite.
 */
export class PostgresStore implements DocumentStore {
	readonly kind = "postgres";
	private readonly client: SqlClient;
	/** Only set when the adapter created the pool and is responsible for ending it. */
	private readonly pool?: pg.Pool;
	private readonly prefix: string;

	constructor(options: PostgresStoreOptions = {}) {
		this.prefix = options.tablePrefix ?? "ic_";
		if (!PREFIX.test(this.prefix)) {
			throw new Error(`Invalid table prefix "${this.prefix}"`);
		}
		if (options.client) {
			this.client = options.client;
		} else if (options.pool === false) {
			this.client = new PerQueryClient(options.connectionString);
		} else {
			this.pool = new pg.Pool({ connectionString: options.connectionString });
			this.client = this.pool;
		}
	}

	private table(collection: CollectionName): string {
		if (!COLLECTIONS.includes(collection)) {
			throw new Error(`Unknown collection "${collection}"`);
		}
		return identifier(`${this.prefix}${collection}`);
	}

	private async run(text: string, params: unknown[] = []): Promise<Row[]> {
		return (await this.client.query(text, params)).rows;
	}

	private conflict(error: unknown, collection: CollectionName): unknown {
		return isUniqueViolation(error)
			? new ConflictError(
					`A ${collection} record with that id or unique field already exists`,
				)
			: error;
	}

	/** Creates every table and index if missing. Safe to call on every boot. */
	async connect(): Promise<void> {
		for (const collection of COLLECTIONS) {
			const table = this.table(collection);
			await this.run(
				`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data JSONB NOT NULL)`,
			);
			for (const index of INDEXES[collection]) {
				const unique = index.unique ? "UNIQUE " : "";
				const name = identifier(
					`${this.prefix}${collection}_${index.field}_idx`,
				);
				await this.run(
					`CREATE ${unique}INDEX IF NOT EXISTS ${name} ON ${table} ((${column(index.field)}))`,
				);
			}
		}
	}

	async disconnect(): Promise<void> {
		await this.pool?.end();
	}

	async ping(): Promise<void> {
		await this.run("SELECT 1");
	}

	async find<C extends CollectionName>(
		collection: C,
		query?: Query,
	): Promise<Doc<C>[]> {
		const params: unknown[] = [];
		const sql = compileSelect(this.table(collection), "data", query, params);
		const rows = await this.run(sql, params);
		return rows.map((row) => row.data as Doc<C>);
	}

	async get<C extends CollectionName>(
		collection: C,
		id: string,
	): Promise<Doc<C> | undefined> {
		const rows = await this.run(
			`SELECT data FROM ${this.table(collection)} WHERE id = $1`,
			[id],
		);
		return rows[0]?.data as Doc<C> | undefined;
	}

	async count<C extends CollectionName>(
		collection: C,
		query?: Query,
	): Promise<number> {
		const params: unknown[] = [];
		const where = compileWhere(query, params);
		const rows = await this.run(
			`SELECT count(*)::int AS count FROM ${this.table(collection)}${where}`,
			params,
		);
		return Number((rows[0] as Row).count);
	}

	async insert<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
	): Promise<Doc<C>> {
		const table = this.table(collection);
		try {
			const rows = await this.run(
				`INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb) RETURNING data`,
				[doc.id, JSON.stringify(doc)],
			);
			return (rows[0] as Row).data as Doc<C>;
		} catch (error) {
			throw this.conflict(error, collection);
		}
	}

	async update<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
		options?: UpdateOptions,
	): Promise<Doc<C> | undefined> {
		const table = this.table(collection);
		const params: unknown[] = [doc.id, JSON.stringify(doc)];
		const where = [
			"id = $1",
			...(options?.where ?? []).map((condition) =>
				compileCondition(condition, params),
			),
		].join(" AND ");
		try {
			const rows = await this.run(
				`UPDATE ${table} SET data = $2::jsonb WHERE ${where} RETURNING data`,
				params,
			);
			return rows[0]?.data as Doc<C> | undefined;
		} catch (error) {
			throw this.conflict(error, collection);
		}
	}

	async delete<C extends CollectionName>(
		collection: C,
		id: string,
	): Promise<boolean> {
		const rows = await this.run(
			`DELETE FROM ${this.table(collection)} WHERE id = $1 RETURNING id`,
			[id],
		);
		return rows.length > 0;
	}

	async deleteMany<C extends CollectionName>(
		collection: C,
		query: Query,
	): Promise<number> {
		// Select the targets with the full query so sort/limit/offset behave
		// exactly like `find`, then count the deleted rows server side.
		const table = this.table(collection);
		const params: unknown[] = [];
		const targets = compileSelect(table, "id", query, params);
		const rows = await this.run(
			`WITH deleted AS (DELETE FROM ${table} WHERE id IN (${targets}) RETURNING id) SELECT count(*)::int AS count FROM deleted`,
			params,
		);
		return Number((rows[0] as Row).count);
	}
}
