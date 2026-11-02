import { getApp } from "@/lib/app";
import { buildPublicStatus } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** Public, CORS-enabled JSON summary for widgets and integrations. */
export async function GET(): Promise<Response> {
	const { services } = await getApp();
	const summary = await services.status.summary();
	return Response.json(buildPublicStatus(summary), {
		headers: {
			"access-control-allow-origin": "*",
			"cache-control": "public, max-age=15, stale-while-revalidate=60",
		},
	});
}
