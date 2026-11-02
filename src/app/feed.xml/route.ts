import { getApp } from "@/lib/app";
import { buildRssFeed } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
	const { services } = await getApp();
	const [settings, incidents] = await Promise.all([
		services.settings.get(),
		services.incidents.list({ limit: 50 }),
	]);
	const base = settings.siteUrl ?? new URL(request.url).origin;
	return new Response(buildRssFeed(settings, incidents, base), {
		headers: { "content-type": "application/rss+xml; charset=utf-8" },
	});
}
