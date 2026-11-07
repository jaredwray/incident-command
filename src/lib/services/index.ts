import { seedDemo } from "../demo";
import { AgentService } from "./agents";
import { ServiceCatalog } from "./catalog";
import type { ServiceContext } from "./context";
import { DraftService } from "./drafts";
import { IncidentService } from "./incidents";
import { MemberService } from "./members";
import { SessionService } from "./sessions";
import { SettingsService } from "./settings";
import { StatusService } from "./status";
import { SubscriberService } from "./subscribers";

export interface Services {
	settings: SettingsService;
	catalog: ServiceCatalog;
	incidents: IncidentService;
	drafts: DraftService;
	status: StatusService;
	members: MemberService;
	sessions: SessionService;
	agents: AgentService;
	subscribers: SubscriberService;
	/** Idempotent first-boot tasks, such as seeding demo data. */
	bootstrap(): Promise<void>;
}

export function createServices(ctx: ServiceContext): Services {
	const settings = new SettingsService(ctx);
	const catalog = new ServiceCatalog(ctx);
	const subscribers = new SubscriberService(ctx, settings);
	const incidents = new IncidentService(ctx, catalog, subscribers, settings);
	const drafts = new DraftService(ctx, incidents);
	const status = new StatusService(ctx, settings, catalog, incidents);
	const sessions = new SessionService(ctx);
	const members = new MemberService(ctx, sessions);
	const agents = new AgentService(ctx);

	return {
		settings,
		catalog,
		incidents,
		drafts,
		status,
		members,
		sessions,
		agents,
		subscribers,
		async bootstrap() {
			if (ctx.config.seedDemo && (await ctx.store.count("services")) === 0) {
				await seedDemo(ctx);
			}
		},
	};
}

export type { ServiceContext } from "./context";
