export const COMPONENT_STATUSES = [
	"operational",
	"under_maintenance",
	"degraded_performance",
	"partial_outage",
	"major_outage",
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export const INCIDENT_KINDS = ["incident", "maintenance"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = [
	"investigating",
	"identified",
	"monitoring",
	"resolved",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const MAINTENANCE_STATUSES = [
	"scheduled",
	"in_progress",
	"verifying",
	"completed",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export type EventStatus = IncidentStatus | MaintenanceStatus;

export const INCIDENT_IMPACTS = ["none", "minor", "major", "critical"] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

export const ROLES = ["viewer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const SUBSCRIBER_TYPES = ["email", "webhook"] as const;
export type SubscriberType = (typeof SUBSCRIBER_TYPES)[number];

export type ActorType = "member" | "agent" | "system";

/** Who performed an action. Stored on incidents/updates for attribution. */
export interface AuthorRef {
	type: ActorType;
	id: string;
	name: string;
}

/** The authenticated principal performing an operation. */
export interface Actor extends AuthorRef {
	role: Role;
}

export interface Settings {
	id: string;
	siteName: string;
	description: string;
	siteUrl?: string;
	logoUrl?: string;
	faviconUrl?: string;
	supportUrl?: string;
	theme: string;
	brandColor?: string;
	customCss?: string;
	allowSubscriptions: boolean;
	uptimeDays: number;
	updatedAt: string;
}

export interface Component {
	id: string;
	name: string;
	description?: string;
	group?: string;
	status: ComponentStatus;
	order: number;
	hidden: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ComponentStatusChange {
	id: string;
	componentId: string;
	status: ComponentStatus;
	previousStatus: ComponentStatus;
	incidentId?: string;
	createdAt: string;
}

export interface IncidentUpdate {
	id: string;
	status: EventStatus;
	message: string;
	author: AuthorRef;
	createdAt: string;
}

export interface Incident {
	id: string;
	kind: IncidentKind;
	title: string;
	status: EventStatus;
	impact: IncidentImpact;
	componentIds: string[];
	updates: IncidentUpdate[];
	scheduledStart?: string;
	scheduledEnd?: string;
	startedAt: string;
	resolvedAt?: string;
	/** Incremented on every write; used for optimistic concurrency. */
	revision?: number;
	createdBy: AuthorRef;
	createdAt: string;
	updatedAt: string;
}

export interface Member {
	id: string;
	email: string;
	name: string;
	role: Role;
	passwordHash: string;
	lastLoginAt?: string;
	createdAt: string;
	updatedAt: string;
}

/** A member without secrets, safe to return from APIs and render. */
export type PublicMember = Omit<Member, "passwordHash">;

export interface Session {
	id: string;
	memberId: string;
	expiresAt: string;
	createdAt: string;
}

export interface AgentToken {
	id: string;
	name: string;
	description?: string;
	tokenHash: string;
	tokenPrefix: string;
	role: Role;
	createdBy: AuthorRef;
	lastUsedAt?: string;
	expiresAt?: string;
	revokedAt?: string;
	createdAt: string;
}

/** An agent token without secrets, safe to return from APIs and render. */
export type PublicAgentToken = Omit<AgentToken, "tokenHash">;

export interface Subscriber {
	id: string;
	type: SubscriberType;
	target: string;
	confirmed: boolean;
	token: string;
	confirmedAt?: string;
	createdAt: string;
}
