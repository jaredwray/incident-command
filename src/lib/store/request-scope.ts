import { AsyncLocalStorage } from "node:async_hooks";

interface ScopedConnection {
	connection: Promise<unknown>;
	close: () => Promise<void>;
}

/**
 * The database connections of one request. Cloudflare Workers do not let a
 * socket outlive the request that opened it, so a store there cannot keep a
 * pool. A scope lets the store open one connection for each request and use
 * it for all of the operations of that request.
 */
export class RequestScope {
	private readonly connections = new Map<object, ScopedConnection>();
	private closed = false;

	/**
	 * Returns the connection of `owner` and opens it on the first call. Returns
	 * `undefined` after `close()`, so a late operation opens its own connection.
	 * A failed open is forgotten, so the next operation tries again.
	 */
	connection<T>(
		owner: object,
		open: () => Promise<T>,
		close: (connection: T) => Promise<void>,
	): Promise<T> | undefined {
		if (this.closed) {
			return undefined;
		}
		const existing = this.connections.get(owner);
		if (existing) {
			return existing.connection as Promise<T>;
		}
		const connection = open();
		this.connections.set(owner, {
			connection,
			close: async () => close(await connection),
		});
		connection.catch(() => this.connections.delete(owner));
		return connection;
	}

	/** Closes each connection. The errors are ignored: the response is already sent. */
	async close(): Promise<void> {
		this.closed = true;
		const connections = [...this.connections.values()];
		this.connections.clear();
		await Promise.allSettled(connections.map((entry) => entry.close()));
	}
}

const globalForScope = globalThis as typeof globalThis & {
	__incidentCommandRequestScope?: AsyncLocalStorage<RequestScope>;
};

// The Worker entry and the app are different bundles, so they share the
// storage through `globalThis`, as `getApp()` does for the app.
globalForScope.__incidentCommandRequestScope ??=
	new AsyncLocalStorage<RequestScope>();
const storage = globalForScope.__incidentCommandRequestScope;

/** The scope of the current request, or `undefined` outside a scope. */
export function currentRequestScope(): RequestScope | undefined {
	return storage.getStore();
}

/**
 * Runs a fetch handler in a new request scope. The scope closes when the
 * response body is fully sent, because a page can still read data while its
 * body streams. `waitUntil` keeps the request alive until the scope closes.
 */
export async function runInRequestScope(
	handle: () => Promise<Response>,
	waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
	const scope = new RequestScope();
	let response: Response;
	try {
		response = await storage.run(scope, handle);
	} catch (error) {
		waitUntil(scope.close());
		throw error;
	}
	if (!response.body) {
		waitUntil(scope.close());
		return response;
	}
	const { readable, writable } = new TransformStream();
	const close = () => scope.close();
	waitUntil(response.body.pipeTo(writable).then(close, close));
	return new Response(readable, response);
}
