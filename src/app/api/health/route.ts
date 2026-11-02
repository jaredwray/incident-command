import { getApp } from "@/lib/app";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe. Returns 503 only when the app cannot start. When
 * the database goes offline after boot the app keeps serving cached data, so
 * this reports `degraded` with a 200 to avoid platforms restarting healthy
 * instances.
 */
export async function GET(): Promise<Response> {
	let app: Awaited<ReturnType<typeof getApp>>;
	try {
		app = await getApp();
	} catch (error) {
		return Response.json(
			{
				status: "unavailable",
				error: error instanceof Error ? error.message : String(error),
			},
			{ status: 503, headers: { "cache-control": "no-store" } },
		);
	}
	try {
		await app.store.ping();
	} catch {
		// health reflects the failure below
	}
	const store = app.store.health;
	return Response.json(
		{ status: store.online ? "ok" : "degraded", store },
		{ headers: { "cache-control": "no-store" } },
	);
}
