export const SERVICE_STATUSES = [
	"operational",
	"under_maintenance",
	"degraded_performance",
	"partial_outage",
	"major_outage",
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

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

export const SUBSCRIBER_TYPES = ["webhook", "email", "sms"] as const;
export type SubscriberType = (typeof SUBSCRIBER_TYPES)[number];

/** A delivery channel. Each subscriber type has the channel with the same name. */
export type NotificationChannel = SubscriberType;
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] =
	SUBSCRIBER_TYPES;

/**
 * How a channel uses its providers. `active_passive` sends through the first
 * provider and uses the next provider only when a send fails (airhorn
 * fail-over). `load_balanced` sends each message through the next provider
 * in turn (airhorn round-robin).
 */
export const DELIVERY_STRATEGIES = ["active_passive", "load_balanced"] as const;
export type DeliveryStrategy = (typeof DELIVERY_STRATEGIES)[number];

export const PROVIDER_TYPES = [
	"webhook",
	"sendgrid",
	"ses",
	"twilio",
	"sns",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type DraftAction = "create" | "update";
export type DraftState = "pending" | "approved" | "discarded";

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

/** A delivery provider that an admin added to a channel. */
export interface NotificationProvider {
	id: string;
	type: ProviderType;
	/** A label that identifies the provider in the portal and in error logs. */
	name: string;
	/** The sender for this provider. It replaces the sender of the channel. */
	from?: string;
	/** Settings that are not secret, such as a region or an account SID. */
	options: Record<string, string>;
	/** Credentials, keyed by field. Each value is encrypted (see `SecretBox`). */
	secrets: Record<string, string>;
	createdAt: string;
	updatedAt: string;
}

/** The delivery settings of one channel. The document id is the channel. */
export interface NotificationChannelSettings {
	id: NotificationChannel;
	enabled: boolean;
	strategy: DeliveryStrategy;
	/** The default sender of the channel (an email address or a phone number). */
	from?: string;
	/** In order. With `active_passive`, the first provider is the active one. */
	providers: NotificationProvider[];
	/** Incremented on every write; used for optimistic concurrency. */
	revision: number;
	updatedAt: string;
}

/** A provider without its credentials, safe to return from APIs and render. */
export interface PublicNotificationProvider
	extends Omit<NotificationProvider, "secrets"> {
	/** The secret fields that have a stored value. */
	savedSecrets: string[];
	/** False when the stored credentials do not decrypt with the configured keys. */
	credentialsReadable: boolean;
}

/** A provider that environment variables configure. */
export interface EnvironmentProvider {
	type: ProviderType;
	name: string;
}

/** The delivery settings of a channel without credentials. */
export interface PublicNotificationChannel
	extends Omit<NotificationChannelSettings, "providers"> {
	providers: PublicNotificationProvider[];
	/** The channel uses these providers only when it has no providers of its own. */
	environmentProviders: EnvironmentProvider[];
	/** The sender that applies when neither the provider nor the channel has one. */
	defaultFrom?: string;
	/** True when the channel is on and has a provider that can send. */
	available: boolean;
}

export interface Service {
	id: string;
	name: string;
	description?: string;
	group?: string;
	status: ServiceStatus;
	order: number;
	hidden: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ServiceStatusChange {
	id: string;
	serviceId: string;
	status: ServiceStatus;
	previousStatus: ServiceStatus;
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
	serviceIds: string[];
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

/** A one-time link that lets a person create their own member account. */
export interface Invite {
	id: string;
	email: string;
	role: Role;
	tokenHash: string;
	invitedBy: AuthorRef;
	expiresAt: string;
	createdAt: string;
}

/** An invite without secrets, safe to return from APIs and render. */
export type PublicInvite = Omit<Invite, "tokenHash">;

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

/** The public text and fields of a notification draft. */
export interface DraftContent {
	/** The title of a new incident or maintenance. Not used by an update. */
	title?: string;
	/** The impact of a new incident. Not used by an update. */
	impact?: IncidentImpact;
	/** The affected services of a new incident or maintenance. Not used by an update. */
	serviceIds?: string[];
	/** The window of new maintenance. Not used by an update. */
	scheduledStart?: string;
	scheduledEnd?: string;
	/** The status after publication. An update without a status keeps the current status. */
	status?: EventStatus;
	/** The public message that subscribers receive. */
	message: string;
	/** Sets the affected services to this status instead of the automatic status. */
	serviceStatus?: ServiceStatus;
}

/**
 * A notification that waits for review by a person. Approval publishes it on
 * the status page and sends it to subscribers. A `create` draft declares a new
 * incident or maintenance. An `update` draft posts to an existing incident.
 */
export interface NotificationDraft {
	id: string;
	action: DraftAction;
	kind: IncidentKind;
	/** The incident that gets the update. A `create` draft gets it at approval. */
	incidentId?: string;
	content: DraftContent;
	state: DraftState;
	createdBy: AuthorRef;
	reviewedBy?: AuthorRef;
	reviewedAt?: string;
	createdAt: string;
	updatedAt: string;
}
