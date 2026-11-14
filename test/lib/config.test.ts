import { detectStoreKind, loadConfig } from "@/lib/config";

const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(40);
const KEY_C = "c".repeat(44);

describe("loadConfig", () => {
	it("uses sensible defaults", () => {
		const config = loadConfig({});
		expect(config).toEqual({
			store: {
				kind: "memory",
				url: undefined,
				databaseName: undefined,
				tablePrefix: "ic_",
				pool: true,
			},
			cache: { ttl: 30_000, maxEntries: 5000 },
			siteUrl: undefined,
			siteName: "Status",
			sessionTtl: 7 * 86_400_000,
			setupToken: undefined,
			emailFrom: undefined,
			emailProvider: undefined,
			sendGridApiKey: undefined,
			aws: undefined,
			webhookSecret: undefined,
			encryption: { key: undefined, previousKeys: [] },
			seedDemo: false,
		});
	});

	it("reads process.env by default", () => {
		vi.stubEnv("SITE_NAME", "From Env");
		expect(loadConfig().siteName).toBe("From Env");
		vi.unstubAllEnvs();
	});

	it("parses a full configuration", () => {
		const config = loadConfig({
			DATABASE_URI: "postgres://u:p@db:5432/status",
			DATABASE_TABLE_PREFIX: "sp_",
			CACHE_TTL: "1m",
			CACHE_MAX_ENTRIES: "100",
			SITE_URL: "https://status.example.com/",
			SITE_NAME: "Example",
			SESSION_TTL: "12h",
			SETUP_TOKEN: "setup",
			EMAIL_FROM: "status@example.com",
			SENDGRID_API_KEY: "SG.1",
			AWS_REGION: "us-east-1",
			AWS_ACCESS_KEY_ID: "AKIA",
			AWS_SECRET_ACCESS_KEY: "secret",
			WEBHOOK_SECRET: "whsec",
			ENCRYPTION_KEY: KEY_A,
			ENCRYPTION_KEY_PREVIOUS: ` ${KEY_B} , ${KEY_C},`,
		});
		expect(config.store).toEqual({
			kind: "postgres",
			url: "postgres://u:p@db:5432/status",
			databaseName: undefined,
			tablePrefix: "sp_",
			pool: true,
		});
		expect(config.cache).toEqual({ ttl: 60_000, maxEntries: 100 });
		expect(config.siteUrl).toBe("https://status.example.com");
		expect(config.sessionTtl).toBe(12 * 3_600_000);
		expect(config.setupToken).toBe("setup");
		expect(config.emailFrom).toBe("status@example.com");
		expect(config.emailProvider).toBe("sendgrid");
		expect(config.sendGridApiKey).toBe("SG.1");
		expect(config.encryption).toEqual({
			key: KEY_A,
			previousKeys: [KEY_B, KEY_C],
		});
		expect(config.aws).toEqual({
			region: "us-east-1",
			accessKeyId: "AKIA",
			secretAccessKey: "secret",
		});
		expect(config.webhookSecret).toBe("whsec");
	});

	it("detects SES email", () => {
		const config = loadConfig({
			EMAIL_FROM: "status@example.com",
			AWS_SES_REGION: "eu-west-1",
			AWS_REGION: "us-east-1",
		});
		expect(config.emailProvider).toBe("ses");
		expect(config.aws?.region).toBe("eu-west-1");
	});

	it("honors explicit store and email provider overrides", () => {
		const config = loadConfig({
			STORE: "mongo",
			DATABASE_URI: "memory://",
			EMAIL_FROM: "x@y.co",
			EMAIL_PROVIDER: "ses",
		});
		expect(config.store.kind).toBe("mongo");
		expect(config.emailProvider).toBe("ses");
	});

	it("keeps the sender when no email provider is configured", () => {
		const config = loadConfig({ EMAIL_FROM: "x@y.co" });
		expect(config.emailFrom).toBe("x@y.co");
		expect(config.emailProvider).toBeUndefined();
	});

	it("rejects encryption keys that are too short", () => {
		expect(() => loadConfig({ ENCRYPTION_KEY: "short" })).toThrow(
			/ENCRYPTION_KEY: Use at least 32 characters/,
		);
		expect(() =>
			loadConfig({ ENCRYPTION_KEY: KEY_A, ENCRYPTION_KEY_PREVIOUS: "old" }),
		).toThrow(/ENCRYPTION_KEY_PREVIOUS\.0: Use at least 32 characters/);
	});

	it("treats empty strings as unset", () => {
		const config = loadConfig({
			SITE_URL: "",
			SETUP_TOKEN: "",
			SITE_NAME: "  ",
			CACHE_TTL: "",
			STORE: "",
			EMAIL_PROVIDER: " ",
			CACHE_MAX_ENTRIES: "",
			DATABASE_POOL: "",
			UNSET: undefined,
		});
		expect(config.store.kind).toBe("memory");
		expect(config.siteUrl).toBeUndefined();
		expect(config.setupToken).toBeUndefined();
		expect(config.siteName).toBe("Status");
		expect(config.cache.ttl).toBe(30_000);
	});

	it("rejects invalid values with readable errors", () => {
		expect(() => loadConfig({ CACHE_TTL: "soon" })).toThrow(
			/CACHE_TTL: Invalid duration "soon"/,
		);
		expect(() => loadConfig({ SITE_URL: "not a url" })).toThrow(
			/Invalid configuration: SITE_URL/,
		);
		expect(() => loadConfig({ CACHE_TTL: "-5" })).toThrow(/CACHE_TTL/);
		expect(() => loadConfig({ STORE: "redis" })).toThrow(/STORE/);
	});
});

describe("detectStoreKind", () => {
	it("detects adapters from the url scheme", () => {
		expect(detectStoreKind(undefined)).toBe("memory");
		expect(detectStoreKind("memory://")).toBe("memory");
		expect(detectStoreKind("postgresql://x")).toBe("postgres");
		expect(detectStoreKind("postgres://x")).toBe("postgres");
		expect(detectStoreKind("mongodb://x")).toBe("mongo");
		expect(detectStoreKind("mongodb+srv://x")).toBe("mongo");
		expect(() => detectStoreKind("mysql://x")).toThrow(
			/Unsupported DATABASE_URI/,
		);
	});
});

describe("parseDuration", () => {
	it("parses shorthand and rejects invalid or negative values", async () => {
		const { parseDuration } = await import("@/lib/config");
		expect(parseDuration("1m")).toBe(60_000);
		expect(parseDuration("250")).toBe(250);
		expect(parseDuration("-1")).toBeUndefined();
		expect(parseDuration("abc")).toBeUndefined();
	});
});

describe("connection pooling", () => {
	it("pools by default, honors DATABASE_POOL and disables pooling on Workers", async () => {
		const { isCloudflareWorkers } = await import("@/lib/config");
		expect(isCloudflareWorkers()).toBe(false);
		expect(loadConfig({ DATABASE_POOL: "false" }).store.pool).toBe(false);
		vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
		expect(isCloudflareWorkers()).toBe(true);
		expect(loadConfig({}).store.pool).toBe(false);
		expect(loadConfig({ DATABASE_POOL: "true" }).store.pool).toBe(true);
		vi.unstubAllGlobals();
	});
});
