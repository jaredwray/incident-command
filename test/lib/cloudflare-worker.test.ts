import { createWorker } from "@/lib/cloudflare-worker";
import {
	currentRequestScope,
	type RequestScope,
} from "@/lib/store/request-scope";

describe("createWorker", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("runs the OpenNext worker in a request scope", async () => {
		let scope: RequestScope | undefined;
		const openNext = {
			fetch: vi.fn(async () => {
				scope = currentRequestScope();
				return new Response("ok");
			}),
		};
		const pending: Promise<unknown>[] = [];
		const env = {};
		const ctx = {
			waitUntil: (promise: Promise<unknown>) => pending.push(promise),
		};
		const request = new Request("https://status.test/manage/services");

		const response = await createWorker(openNext).fetch(request, env, ctx);

		await expect(response.text()).resolves.toBe("ok");
		expect(openNext.fetch).toHaveBeenCalledWith(request, env, ctx);
		expect(scope).toBeDefined();
		// The scope closes through waitUntil, after the body is sent.
		expect(pending).toHaveLength(1);
		await Promise.all(pending);
	});

	it("gives the Hyperdrive connection string to the app as DATABASE_URI", async () => {
		vi.stubEnv("DATABASE_URI", "mongodb://old/db");
		const openNext = {
			fetch: vi.fn(async () => new Response(process.env.DATABASE_URI)),
		};
		const worker = createWorker(openNext);
		const ctx = { waitUntil: () => {} };
		const request = new Request("https://status.test/");

		const withBinding = await worker.fetch(
			request,
			{ HYPERDRIVE: { connectionString: "postgres://hyperdrive/db" } },
			ctx,
		);
		await expect(withBinding.text()).resolves.toBe("postgres://hyperdrive/db");

		vi.stubEnv("DATABASE_URI", "mongodb://secret/db");
		const withoutBinding = await worker.fetch(request, {}, ctx);
		await expect(withoutBinding.text()).resolves.toBe("mongodb://secret/db");
	});
});
