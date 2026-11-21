import type {
	Agent,
	AgentActivity,
	AgentToken,
	BrandAsset,
	Invite,
	Member,
	NotificationChannelSettings,
	NotificationDelivery,
	NotificationDraft,
	NotificationJob,
	NotificationQueueSettings,
	OAuthClient,
	OAuthCode,
	OAuthGrant,
	Region,
	Service,
	ServiceStatusChange,
	Session,
	Settings,
	StoredIncident,
	Subscriber,
} from "../domain/types";

/** Every collection the application persists, keyed by name. */
export interface CollectionMap {
	settings: Settings;
	brand_assets: BrandAsset;
	services: Service;
	regions: Region;
	service_status_changes: ServiceStatusChange;
	incidents: StoredIncident;
	members: Member;
	invites: Invite;
	sessions: Session;
	agents: Agent;
	agent_tokens: AgentToken;
	agent_activity: AgentActivity;
	oauth_clients: OAuthClient;
	oauth_codes: OAuthCode;
	oauth_grants: OAuthGrant;
	subscribers: Subscriber;
	notification_drafts: NotificationDraft;
	notification_channels: NotificationChannelSettings;
	notification_queue: NotificationQueueSettings;
	notification_jobs: NotificationJob;
	notification_deliveries: NotificationDelivery;
}

export type CollectionName = keyof CollectionMap;
export type Doc<C extends CollectionName> = CollectionMap[C];

export const COLLECTIONS: readonly CollectionName[] = [
	"settings",
	"brand_assets",
	"services",
	"regions",
	"service_status_changes",
	"incidents",
	"members",
	"invites",
	"sessions",
	"agents",
	"agent_tokens",
	"agent_activity",
	"oauth_clients",
	"oauth_codes",
	"oauth_grants",
	"subscribers",
	"notification_drafts",
	"notification_channels",
	"notification_queue",
	"notification_jobs",
	"notification_deliveries",
];

export interface IndexDefinition {
	field: string;
	unique?: boolean;
}

/**
 * Secondary indexes each adapter should create. Unique indexes are also
 * enforced by the memory adapter so behavior matches across stores.
 */
export const INDEXES: Record<CollectionName, readonly IndexDefinition[]> = {
	settings: [],
	brand_assets: [],
	services: [{ field: "order" }],
	regions: [{ field: "order" }],
	service_status_changes: [{ field: "serviceId" }, { field: "createdAt" }],
	incidents: [{ field: "status" }, { field: "createdAt" }],
	members: [{ field: "email", unique: true }],
	invites: [
		{ field: "tokenHash", unique: true },
		{ field: "email", unique: true },
	],
	sessions: [{ field: "memberId" }, { field: "expiresAt" }],
	agents: [{ field: "ownerId" }],
	agent_tokens: [{ field: "tokenHash", unique: true }, { field: "agentId" }],
	agent_activity: [{ field: "agentId" }, { field: "createdAt" }],
	oauth_clients: [{ field: "createdAt" }],
	oauth_codes: [{ field: "memberId" }, { field: "expiresAt" }],
	oauth_grants: [
		{ field: "accessTokenHash", unique: true },
		{ field: "refreshTokenHash", unique: true },
		{ field: "memberId" },
		{ field: "agentId" },
		{ field: "refreshTokenExpiresAt" },
	],
	subscribers: [
		{ field: "token", unique: true },
		{ field: "target", unique: true },
	],
	notification_drafts: [
		{ field: "state" },
		{ field: "createdAt" },
		{ field: "incidentId" },
	],
	notification_channels: [],
	notification_queue: [],
	notification_jobs: [
		{ field: "incidentId" },
		{ field: "state" },
		{ field: "createdAt" },
	],
	notification_deliveries: [{ field: "jobId" }, { field: "createdAt" }],
};

export type Scalar = string | number | boolean | null;

export type Operator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";

/**
 * A single field condition. Semantics are identical across adapters:
 * - `eq null` matches missing or null fields
 * - `ne` matches documents where the field is missing
 * - range operators never match missing fields
 */
export type Condition =
	| { field: string; op: Exclude<Operator, "in">; value: Scalar }
	| { field: string; op: "in"; value: readonly Scalar[] };

export interface SortSpec {
	field: string;
	direction?: "asc" | "desc";
}

/**
 * A portable query. Sorting should only be done on fields every document has,
 * because adapters order missing values differently.
 */
export interface Query {
	where?: readonly Condition[];
	sort?: readonly SortSpec[];
	limit?: number;
	offset?: number;
}

export interface UpdateOptions {
	/**
	 * Only replace the document when the stored version matches every
	 * condition (optimistic concurrency). Resolves `undefined` otherwise.
	 */
	where?: readonly Condition[];
}

export interface ReadOptions {
	/** Bypass any caching layer and read directly from the source of truth. */
	consistent?: boolean;
}

/**
 * The minimal document-store contract every storage adapter implements.
 * Documents are plain JSON objects with a string `id`.
 */
export interface DocumentStore {
	readonly kind: string;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	/** Resolves when the store is reachable, rejects otherwise. */
	ping(): Promise<void>;
	find<C extends CollectionName>(
		collection: C,
		query?: Query,
		options?: ReadOptions,
	): Promise<Doc<C>[]>;
	get<C extends CollectionName>(
		collection: C,
		id: string,
		options?: ReadOptions,
	): Promise<Doc<C> | undefined>;
	count<C extends CollectionName>(
		collection: C,
		query?: Query,
		options?: ReadOptions,
	): Promise<number>;
	/** Inserts a new document. Throws `ConflictError` on duplicate id or unique field. */
	insert<C extends CollectionName>(collection: C, doc: Doc<C>): Promise<Doc<C>>;
	/**
	 * Replaces an existing document by id. Resolves `undefined` when it does
	 * not exist or does not match `options.where`.
	 */
	update<C extends CollectionName>(
		collection: C,
		doc: Doc<C>,
		options?: UpdateOptions,
	): Promise<Doc<C> | undefined>;
	delete<C extends CollectionName>(collection: C, id: string): Promise<boolean>;
	deleteMany<C extends CollectionName>(
		collection: C,
		query: Query,
	): Promise<number>;
}
