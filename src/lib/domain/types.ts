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

/** The provider types that an admin can add to the email or text messaging channel. */
export const PROVIDER_TYPES = ["sendgrid", "ses", "twilio", "sns"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** The qified providers. An admin selects one, or no queue. */
export const QUEUE_PROVIDER_IDS = ["redis", "rabbitmq", "nats"] as const;
export type QueueProviderId = (typeof QUEUE_PROVIDER_IDS)[number];

/** Why a queued job ran in this process. */
export type QueueFallback = "load" | "enqueue" | "stalled";

/** The state of one notification in a send job. */
export type DeliveryState = "pending" | "sending" | "sent" | "failed";

/** Why one notification failed. */
export type DeliveryFailure = "provider" | "not_sent" | "interrupted";

/**
 * The kind of notice. A queued job keeps this value, so a later post does
 * not change the notice.
 */
export type NotificationEvent =
	| "incident.created"
	| "incident.updated"
	| "incident.resolved"
	| "maintenance.scheduled"
	| "maintenance.updated"
	| "maintenance.completed";

/** A provider type, or `webhook`: the built-in webhook sender of the server. */
export type SenderType = ProviderType | "webhook";

export type DraftAction = "create" | "update";
export type DraftState = "pending" | "approved" | "discarded";

export type ActorType = "member" | "agent" | "system";

/** Who performed an action. Stored on incidents/updates for attribution. */
export interface AuthorRef {
	type: ActorType;
	id: string;
	name: string;
}

/** A credential that an agent uses to call the MCP server. */
export interface AgentCredential {
	type: "token" | "oauth";
	id: string;
}

/** A signed-in member, or the system actor. */
export type MemberActor = AuthorRef & {
	type: "member" | "system";
	role: Role;
};

/** An agent. Its permissions are the ones in effect for this credential. */
export type AgentActor = AuthorRef & {
	type: "agent";
	permissions: readonly string[];
	credential: AgentCredential;
};

/** The authenticated principal performing an operation. */
export type Actor = MemberActor | AgentActor;

export interface Settings {
	id: string;
	siteName: string;
	description: string;
	siteUrl?: string;
	supportUrl?: string;
	theme: string;
	customCss?: string;
	/** When false, the public pages do not show "Powered by Incident Command". */
	showPoweredBy: boolean;
	/**
	 * When true, a member must turn on an authenticator before the portal opens.
	 * The value starts as true.
	 */
	requireTwoFactor: boolean;
	uptimeDays: number;
	/** Set when an admin uploads a logo. The image is at /brand/logo. */
	logoUpdatedAt?: string;
	/** Set when an admin uploads a favicon. The image is at /brand/favicon. */
	faviconUpdatedAt?: string;
	updatedAt: string;
}

/** The files an admin can upload for the brand. */
export const BRAND_ASSET_KINDS = ["logo", "favicon"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

/** A logo or favicon file an admin uploaded. */
export interface BrandAsset {
	/** The kind of the file. */
	id: string;
	contentType: string;
	/** Base64-encoded image bytes. */
	data: string;
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
	/**
	 * The webhook channel only: when true, webhooks may post to private network
	 * addresses. Off by default, so a webhook URL cannot reach a host inside the
	 * network of the server.
	 */
	allowPrivateNetworks?: boolean;
	/** Incremented on every write; used for optimistic concurrency. */
	revision: number;
	updatedAt: string;
}

/** The queue settings. One document, id `queue`. No provider means no queue. */
export interface NotificationQueueSettings {
	id: "queue";
	provider?: QueueProviderId;
	/** The connection URI, encrypted. */
	uri?: string;
	revision: number;
	updatedAt: string;
}

/** One send of the notifications for one post. */
export interface NotificationJob {
	id: string;
	incidentId: string;
	updateId: string;
	event: NotificationEvent;
	/** True when a queue provider was set at the start of the send. */
	queued: boolean;
	provider?: QueueProviderId;
	fallback?: QueueFallback;
	state: "active" | "done";
	total: number;
	/** Final counts. The service writes them once, when the job is done. */
	sent: number;
	failed: number;
	createdBy: AuthorRef;
	createdAt: string;
	heartbeatAt: string;
	finishedAt?: string;
}

/** One notification inside a send job. The label hides the address. */
export interface NotificationDelivery {
	id: string;
	jobId: string;
	subscriberId: string;
	channel: NotificationChannel;
	label: string;
	order: number;
	state: DeliveryState;
	error?: DeliveryFailure;
	createdAt: string;
	updatedAt: string;
}

/** One row of a send job, safe to show in the portal. */
export interface NotificationDeliveryView {
	id: string;
	channel: NotificationChannel;
	order: number;
	state: DeliveryState;
	label?: string;
	error?: DeliveryFailure;
}

/** A send job, safe to show in the portal. */
export interface NotificationJobView {
	id: string;
	incidentId: string;
	state: "active" | "done";
	total: number;
	sent: number;
	failed: number;
	queued: boolean;
	fallback?: QueueFallback;
	deliveries: NotificationDeliveryView[];
	truncated: boolean;
}

/** The progress of the queued sends for one incident. */
export interface NotificationProgress {
	total: number;
	done: number;
	sent: number;
	failed: number;
	active: number;
	fallback: boolean;
}

/** The queue choice, without the connection URI. */
export interface PublicNotificationQueue {
	provider?: QueueProviderId;
	hasUri: boolean;
	revision: number;
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
	type: SenderType;
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

/**
 * A named region on the status page. Global is not a record.
 * An incident with no region is global.
 */
export interface Region {
	id: string;
	name: string;
	order: number;
	createdAt: string;
	updatedAt: string;
}

/** The status for one affected service of an incident or maintenance. */
export interface ServiceStatusOverride {
	serviceId: string;
	status: ServiceStatus;
}

/**
 * Regions where one affected service is down.
 * An empty list means Global. A Global service stays on the Global tab.
 */
export interface ServiceRegions {
	serviceId: string;
	regionIds: string[];
}

export interface ServiceStatusChange {
	id: string;
	serviceId: string;
	status: ServiceStatus;
	previousStatus: ServiceStatus;
	incidentId?: string;
	createdAt: string;
}

/**
 * A post as the store may hold it. Posts from an old version omit `title`
 * and `impact`. The service fills those fields on read.
 */
export interface StoredIncidentUpdate {
	id: string;
	status: EventStatus;
	message: string;
	author: AuthorRef;
	/** The author asked to notify subscribers. Old posts omit this field. */
	notified?: boolean;
	createdAt: string;
	/** The title that this post records. Old posts omit this field. */
	title?: string;
	/** The impact that this post records. Old posts omit this field. */
	impact?: IncidentImpact;
}

/** One post on an incident. It always has the title and the impact. */
export interface IncidentUpdate extends StoredIncidentUpdate {
	title: string;
	impact: IncidentImpact;
}

/** The record of a deletion from the public view. */
export interface IncidentDeletion {
	/** The time when the incident left the public view. */
	deletedAt: string;
	/** The member or agent that deleted the incident. */
	deletedBy: AuthorRef;
	/** The reason that the member or agent gave. */
	deletedReason: string;
}

export interface Incident extends Partial<IncidentDeletion> {
	id: string;
	kind: IncidentKind;
	/** The title of the latest post. */
	title: string;
	status: EventStatus;
	/** The impact of the latest post. */
	impact: IncidentImpact;
	serviceIds: string[];
	/**
	 * Regions for each affected service.
	 * A service with no entry, or an empty list, is Global.
	 * An old incident can omit this field and set `regionId` for every service.
	 */
	serviceRegions?: ServiceRegions[];
	/**
	 * The region of every service on an old incident.
	 * New writes omit this field. Read it only when `serviceRegions` is absent.
	 */
	regionId?: string;
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

/** An incident document. Posts from an old version can omit title and impact. */
export interface StoredIncident extends Omit<Incident, "updates"> {
	updates: StoredIncidentUpdate[];
}

/** Authenticator data for one member. APIs and pages do not receive this object. */
export interface MemberTwoFactor {
	/** The TOTP secret. The value is `plain:` or an encrypted SecretBox value. */
	secret: string;
	/** The time step of the last accepted authenticator code. */
	lastStep?: number;
	/** SHA-256 hashes of the recovery codes that are still unused. */
	recoveryCodeHashes: string[];
	/** Plaintext recovery codes until the member hides them. */
	recoveryReveal?: string[];
	/** Set when the member confirms the first authenticator code. */
	enabledAt?: string;
}

export interface Member {
	id: string;
	email: string;
	name: string;
	role: Role;
	passwordHash: string;
	twoFactor?: MemberTwoFactor;
	lastLoginAt?: string;
	/** Incremented on every write so two saves cannot drop a code. */
	revision?: number;
	createdAt: string;
	updatedAt: string;
}

/** A member without secrets, safe to return from APIs and render. */
export type PublicMember = Omit<
	Member,
	"passwordHash" | "twoFactor" | "revision"
> & {
	twoFactorEnabled: boolean;
};

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

/** `totp` waits for a code. `enroll` waits until the member turns an authenticator on. */
export type SessionPurpose = "totp" | "enroll";

export interface Session {
	id: string;
	memberId: string;
	expiresAt: string;
	createdAt: string;
	/** A full session has no purpose. A challenge session has one of these values. */
	purpose?: SessionPurpose;
	/** Failed code attempts for a challenge. A full session has no attempts. */
	attempts?: number;
}

/** An agent. API tokens and OAuth grants are credentials for this record. */
export interface Agent {
	id: string;
	name: string;
	description?: string;
	permissions: string[];
	ownerId?: string;
	/** Set when migration built this agent from an old token or OAuth grant. */
	migratedFrom?: "token" | "oauth";
	createdBy: AuthorRef;
	revision: number;
	createdAt: string;
	updatedAt: string;
}

/**
 * An API token for an agent. Tokens created before permissions also have
 * `name`, `description` and `role`.
 */
export interface AgentToken {
	id: string;
	agentId?: string;
	name?: string;
	description?: string;
	tokenHash: string;
	tokenPrefix: string;
	role?: Role;
	createdBy: AuthorRef;
	lastUsedAt?: string;
	expiresAt?: string;
	revokedAt?: string;
	createdAt: string;
}

export const AGENT_ACTIVITY_TYPES = [
	"tool_call",
	"agent_created",
	"agent_renamed",
	"permissions_changed",
	"token_created",
	"token_revoked",
	"oauth_connected",
	"oauth_disconnected",
	"owner_removed",
	"draft_approved",
	"draft_discarded",
] as const;
export type AgentActivityType = (typeof AGENT_ACTIVITY_TYPES)[number];

export type AgentActivityOutcome = "ok" | "denied" | "error";

/** One row in the activity log of an agent. It never holds a secret. */
export interface AgentActivity {
	id: string;
	agentId: string;
	type: AgentActivityType;
	actor: AuthorRef;
	credential?: AgentCredential;
	tool?: string;
	target?: { type: string; id: string; label?: string };
	outcome: AgentActivityOutcome;
	code?: string;
	permission?: string;
	added?: string[];
	removed?: string[];
	createdAt: string;
}

/**
 * An OAuth client that an agent registered with dynamic client registration
 * (RFC 7591). All clients are public clients: they have no secret and they
 * must use PKCE. The id is the `client_id`.
 */
export interface OAuthClient {
	id: string;
	/** The name that the agent reported. Nobody verified it. */
	name: string;
	redirectUris: string[];
	createdAt: string;
	/** The first time that a member approved the client. */
	authorizedAt?: string;
}

/** A one-time authorization code. The id is the SHA-256 hash of the code. */
export interface OAuthCode {
	id: string;
	/** The name that the member chose for this connection. */
	clientName?: string;
	clientId: string;
	memberId: string;
	redirectUri: string;
	/** The PKCE `S256` code challenge. */
	codeChallenge: string;
	/** The existing agent that the member chose. A new agent has no id yet. */
	agentId?: string;
	/** The RFC 8707 resource indicator of the authorization request. */
	resource?: string;
	expiresAt: string;
	createdAt: string;
}

/**
 * An agent that a member connected with OAuth. The agent acts as the member,
 * with the current role of the member. Only hashes of the tokens are stored.
 */
export interface OAuthGrant {
	id: string;
	clientId: string;
	clientName: string;
	memberId: string;
	resource?: string;
	accessTokenHash: string;
	accessTokenExpiresAt: string;
	refreshTokenHash: string;
	refreshTokenExpiresAt: string;
	/** The agent that this connection acts as. */
	agentId?: string;
	lastUsedAt?: string;
	createdAt: string;
}

/** A connected agent, safe to return from APIs and render. */
export interface AgentConnection {
	id: string;
	clientName: string;
	memberId: string;
	memberName: string;
	lastUsedAt?: string;
	/** The connection stops when the agent does not refresh its token before this time. */
	expiresAt: string;
	createdAt: string;
}

export interface Subscriber {
	id: string;
	type: SubscriberType;
	target: string;
	confirmed: boolean;
	token: string;
	confirmedAt?: string;
	createdAt: string;
	/**
	 * Services that send a notification to this subscriber.
	 * Omit the list to send a notification for every service.
	 */
	serviceIds?: string[];
}

/** The public text and fields of a notification draft. */
export interface DraftContent {
	/**
	 * The title of a new incident or maintenance.
	 * An update stores a new title here. An absent title keeps the current title.
	 */
	title?: string;
	/**
	 * The impact of a new incident.
	 * An update stores a new impact here. An absent impact keeps the current impact.
	 */
	impact?: IncidentImpact;
	/**
	 * The affected services of a new incident or maintenance.
	 * On an update, the services to add. An update does not remove a service.
	 */
	serviceIds?: string[];
	/**
	 * Regions for each affected service.
	 * On an update, regions for the services in this draft.
	 * A service with no entry, or an empty list, is Global.
	 */
	serviceRegions?: ServiceRegions[];
	/** The window of new maintenance. Not used by an update. */
	scheduledStart?: string;
	scheduledEnd?: string;
	/** The status after publication. An update without a status keeps the current status. */
	status?: EventStatus;
	/** The public message that subscribers receive. */
	message: string;
	/** Sets the affected services to this status instead of the automatic status. */
	serviceStatus?: ServiceStatus;
	/** Statuses for single affected services. Each one replaces `serviceStatus` for its service. */
	serviceStatuses?: ServiceStatusOverride[];
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
	publishedAt?: string;
	/** The id of the post that this draft published. */
	updateId?: string;
	createdAt: string;
	updatedAt: string;
}
