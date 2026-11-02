import { AgentService } from "./agents";
import { ComponentService } from "./components";
import type { ServiceContext } from "./context";
import { IncidentService } from "./incidents";
import { MemberService } from "./members";
import { SessionService } from "./sessions";
import { SettingsService } from "./settings";
import { StatusService } from "./status";
import { SubscriberService } from "./subscribers";

export interface Services {
	settings: SettingsService;
	components: ComponentService;
	incidents: IncidentService;
	status: StatusService;
	members: MemberService;
	sessions: SessionService;
	agents: AgentService;
	subscribers: SubscriberService;
	/** Idempotent first-boot tasks such as creating the admin from env vars. */
	bootstrap(): Promise<void>;
}

export function createServices(ctx: ServiceContext): Services {
	const settings = new SettingsService(ctx);
	const components = new ComponentService(ctx);
	const subscribers = new SubscriberService(ctx, settings);
	const incidents = new IncidentService(ctx, components, subscribers, settings);
	const status = new StatusService(ctx, settings, components, incidents);
	const sessions = new SessionService(ctx);
	const members = new MemberService(ctx, sessions);
	const agents = new AgentService(ctx);

	return {
		settings,
		components,
		incidents,
		status,
		members,
		sessions,
		agents,
		subscribers,
		async bootstrap() {
			const admin = ctx.config.admin;
			if (admin && (await members.count()) === 0) {
				await members.setup(admin, ctx.config.setupToken);
			}
		},
	};
}

export type { ServiceContext } from "./context";
