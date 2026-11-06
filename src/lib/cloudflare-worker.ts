import { runInRequestScope } from "./store/request-scope";

/** The bindings that the Worker entry reads. */
export interface WorkerEnv {
	/** A Hyperdrive binding. Its connection string becomes `DATABASE_URI`. */
	HYPERDRIVE?: { connectionString: string };
}

/** The part of the Workers `ExecutionContext` that the entry uses. */
export interface WorkerContext {
	waitUntil(promise: Promise<unknown>): void;
}

/** A Worker with a `fetch` handler, such as the one that OpenNext builds. */
export interface FetchWorker<Env, Context> {
	fetch(request: Request, env: Env, ctx: Context): Response | Promise<Response>;
}

/**
 * Wraps the OpenNext Worker. Each request runs in a request scope, so a store
 * without a pool opens one database connection for each request, not one for
 * each operation. A Hyperdrive binding, if present, gives the database URI.
 */
export function createWorker<
	Env extends WorkerEnv,
	Context extends WorkerContext,
>(worker: FetchWorker<Env, Context>): FetchWorker<Env, Context> {
	return {
		fetch(request, env, ctx) {
			if (env.HYPERDRIVE) {
				process.env.DATABASE_URI = env.HYPERDRIVE.connectionString;
			}
			return runInRequestScope(
				async () => worker.fetch(request, env, ctx),
				(promise) => ctx.waitUntil(promise),
			);
		},
	};
}
