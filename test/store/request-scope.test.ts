import {
	currentRequestScope,
	type RequestScope,
	runInRequestScope,
} from "@/lib/store/request-scope";

/** Collects the promises given to `waitUntil`, as the Workers runtime does. */
function waitUntilCollector() {
	const pending: Promise<unknown>[] = [];
	return {
		waitUntil: (promise: Promise<unknown>) => {
			pending.push(promise);
		},
		settled: () => Promise.all(pending),
	};
}

function fakeConnection() {
	const connection = { name: "connection" };
	return {
		connection,
		open: vi.fn(async () => connection),
		close: vi.fn(async (_connection: typeof connection) => {}),
	};
}

describe("runInRequestScope", () => {
	it("shares one connection for each owner and closes it after the body is sent", async () => {
		const { connection, open, close } = fakeConnection();
		const owner = {};
		const { waitUntil, settled } = waitUntilCollector();
		let release = () => {};
		let scope: RequestScope | undefined;
		let streamed: { scope?: RequestScope; connection?: unknown } = {};
		const response = await runInRequestScope(async () => {
			scope = currentRequestScope();
			const both = await Promise.all([
				scope?.connection(owner, open, close),
				scope?.connection(owner, open, close),
			]);
			expect(both).toEqual([connection, connection]);
			let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
			const body = new ReadableStream<Uint8Array>({
				start: (value) => {
					controller = value;
				},
			});
			// A streamed page goes on after the handler returns its response.
			void new Promise<void>((resolve) => {
				release = resolve;
			}).then(async () => {
				streamed = {
					scope: currentRequestScope(),
					connection: await currentRequestScope()?.connection(
						owner,
						open,
						close,
					),
				};
				controller?.enqueue(new TextEncoder().encode("done"));
				controller?.close();
			});
			return new Response(body, {
				status: 201,
				headers: { "x-test": "kept" },
			});
		}, waitUntil);

		expect(response.status).toBe(201);
		expect(response.headers.get("x-test")).toBe("kept");
		expect(currentRequestScope()).toBeUndefined();
		release();
		await expect(response.text()).resolves.toBe("done");
		await settled();
		expect(streamed).toEqual({ scope, connection });
		expect(open).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledWith(connection);
	});

	it("closes the scope when the response has no body, and then gives no connection", async () => {
		const { connection, open, close } = fakeConnection();
		const owner = {};
		const { waitUntil, settled } = waitUntilCollector();
		let scope: RequestScope | undefined;
		const empty = new Response(null, { status: 204 });
		const response = await runInRequestScope(async () => {
			scope = currentRequestScope();
			await scope?.connection(owner, open, close);
			return empty;
		}, waitUntil);
		expect(response).toBe(empty);
		await settled();
		expect(close).toHaveBeenCalledWith(connection);
		// Work that goes on after the request opens its own connection.
		expect(scope?.connection(owner, open, close)).toBeUndefined();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("closes the scope when the handler fails", async () => {
		const { connection, open, close } = fakeConnection();
		const { waitUntil, settled } = waitUntilCollector();
		await expect(
			runInRequestScope(async () => {
				await currentRequestScope()?.connection({}, open, close);
				throw new Error("render failed");
			}, waitUntil),
		).rejects.toThrow("render failed");
		await settled();
		expect(close).toHaveBeenCalledWith(connection);
	});

	it("forgets a failed open, so the next operation tries again", async () => {
		const { connection, open, close } = fakeConnection();
		open.mockRejectedValueOnce(new Error("connection refused"));
		const owner = {};
		const { waitUntil, settled } = waitUntilCollector();
		await runInRequestScope(async () => {
			const scope = currentRequestScope();
			await expect(scope?.connection(owner, open, close)).rejects.toThrow(
				"connection refused",
			);
			await expect(scope?.connection(owner, open, close)).resolves.toBe(
				connection,
			);
			return new Response(null);
		}, waitUntil);
		await settled();
		expect(open).toHaveBeenCalledTimes(2);
		expect(close).toHaveBeenCalledTimes(1);
	});
});
