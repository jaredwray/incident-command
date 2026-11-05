import type { Actor } from "./domain/types";
import { DAY_MS } from "./domain/uptime";
import { createServices } from "./services";
import type { ServiceContext } from "./services/context";

const DEMO_ACTOR: Actor = {
	type: "system",
	id: "demo",
	name: "Demo",
	role: "admin",
};
const HOUR_MS = 3_600_000;

/**
 * Seeds a realistic status page: grouped services, a few past incidents
 * spread across the uptime window and an upcoming maintenance. Uses a
 * movable clock so history lands in the past.
 */
export async function seedDemo(ctx: ServiceContext): Promise<void> {
	const end = ctx.now().getTime();
	let cursor = end - 95 * DAY_MS;
	const services = createServices({ ...ctx, now: () => new Date(cursor) });
	const at = (daysAgo: number, hour = 0) => {
		cursor = end - daysAgo * DAY_MS + hour * HOUR_MS;
	};

	const make = (name: string, group: string, description: string) =>
		services.catalog.create(DEMO_ACTOR, { name, group, description });
	const website = await make(
		"Website",
		"Web",
		"Marketing site and documentation",
	);
	const dashboard = await make("Dashboard", "Web", "The web application");
	const api = await make("REST API", "API", "Public REST API");
	const webhooks = await make("Webhooks", "API", "Outbound webhook delivery");
	const database = await make(
		"Database",
		"Infrastructure",
		"Primary data store",
	);

	at(41, 14);
	const latency = await services.incidents.create(DEMO_ACTOR, {
		title: "Elevated API latency",
		message: "We are investigating slower than normal API responses.",
		impact: "minor",
		serviceIds: [api.id],
	});
	at(41, 15);
	await services.incidents.postUpdate(DEMO_ACTOR, latency.id, {
		status: "identified",
		message:
			"A noisy neighbor on one database replica is causing slow queries. We are failing over.",
	});
	at(41, 16);
	await services.incidents.resolve(
		DEMO_ACTOR,
		latency.id,
		"Latency is back to normal after the failover.",
	);

	at(17, 9);
	const outage = await services.incidents.create(DEMO_ACTOR, {
		title: "Webhook deliveries delayed",
		message:
			"Webhook deliveries are delayed. Events are queued and will be delivered.",
		impact: "major",
		serviceIds: [webhooks.id],
	});
	at(17, 10);
	await services.incidents.postUpdate(DEMO_ACTOR, outage.id, {
		status: "monitoring",
		message: "Workers have been scaled up and the backlog is draining.",
	});
	at(17, 12);
	await services.incidents.resolve(
		DEMO_ACTOR,
		outage.id,
		"All queued webhooks have been delivered.",
	);

	at(3, 22);
	const down = await services.incidents.create(DEMO_ACTOR, {
		title: "Dashboard unavailable",
		message: "The dashboard is returning errors for all users.",
		impact: "critical",
		serviceIds: [dashboard.id, website.id],
	});
	at(3, 22.5);
	await services.incidents.resolve(
		DEMO_ACTOR,
		down.id,
		"A bad deploy was rolled back and the dashboard is available again.",
	);

	cursor = end;
	await services.incidents.create(DEMO_ACTOR, {
		kind: "maintenance",
		title: "Database upgrade",
		message:
			"We are upgrading the primary database. Brief read-only periods are expected.",
		serviceIds: [database.id],
		scheduledStart: new Date(end + 2 * DAY_MS).toISOString(),
		scheduledEnd: new Date(end + 2 * DAY_MS + 2 * HOUR_MS).toISOString(),
		notify: false,
	});
}
