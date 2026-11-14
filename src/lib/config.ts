import { shorthandToMilliseconds } from "cacheable";
import { z } from "zod";

export type StoreKind = "memory" | "postgres" | "mongo";

export type EmailProviderKind = "sendgrid" | "ses";

export interface Config {
	store: {
		kind: StoreKind;
		url?: string;
		databaseName?: string;
		tablePrefix: string;
		/**
		 * Keep a connection pool (default). Disabled on Cloudflare Workers, where
		 * a socket cannot outlive the request that opened it. Postgres and
		 * MongoDB then connect for each operation.
		 */
		pool: boolean;
	};
	cache: {
		ttl: number;
		maxEntries: number;
	};
	siteUrl?: string;
	siteName: string;
	sessionTtl: number;
	setupToken?: string;
	/** The default email sender (`EMAIL_FROM`). */
	emailFrom?: string;
	/**
	 * The email provider from environment variables. The email channel uses it
	 * only when an admin adds no email provider in the portal.
	 */
	emailProvider?: EmailProviderKind;
	sendGridApiKey?: string;
	aws?: { region: string; accessKeyId?: string; secretAccessKey?: string };
	webhookSecret?: string;
	/** Keys that encrypt provider credentials in the store. */
	encryption: { key?: string; previousKeys: string[] };
	/** Seed demo services and incidents into an empty store on boot. */
	seedDemo: boolean;
}

/** True when running inside Cloudflare Workers (e.g. via OpenNext). */
export function isCloudflareWorkers(): boolean {
	return globalThis.navigator?.userAgent === "Cloudflare-Workers";
}

/** Drops empty and whitespace-only values so `FOO=` behaves like an unset variable. */
function withoutEmpty(
	source: Record<string, string | undefined>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(source)) {
		if (value !== undefined && value.trim() !== "") {
			result[key] = value;
		}
	}
	return result;
}

const optional = z.string().trim().optional();

/** Parses `30s`, `5m`, `7d` or plain milliseconds. Returns `undefined` when invalid. */
export function parseDuration(value: string): number | undefined {
	try {
		const ms = shorthandToMilliseconds(value);
		return ms !== undefined && ms >= 0 ? ms : undefined;
	} catch {
		return undefined;
	}
}

const duration = (fallback: string) =>
	z
		.string()
		.trim()
		.optional()
		.transform((value, ctx) => {
			const ms = parseDuration(value ?? fallback);
			if (ms === undefined) {
				ctx.addIssue({
					code: "custom",
					message: `Invalid duration "${value}"`,
				});
				return z.NEVER;
			}
			return ms;
		});

const MIN_KEY_LENGTH = 32;
const MIN_KEY_MESSAGE = `Use at least ${MIN_KEY_LENGTH} characters, for example the output of: openssl rand -base64 32`;
const encryptionKey = z.string().trim().min(MIN_KEY_LENGTH, MIN_KEY_MESSAGE);

const envSchema = z.object({
	DATABASE_URI: optional,
	STORE: z.enum(["memory", "postgres", "mongo"]).optional(),
	DATABASE_NAME: optional,
	DATABASE_TABLE_PREFIX: optional,
	DATABASE_POOL: z.enum(["true", "false"]).optional(),
	CACHE_TTL: duration("30s"),
	CACHE_MAX_ENTRIES: z.coerce.number().int().positive().optional(),
	SITE_URL: z.url().optional(),
	SITE_NAME: optional,
	SESSION_TTL: duration("7d"),
	SETUP_TOKEN: optional,
	EMAIL_FROM: optional,
	EMAIL_PROVIDER: z.enum(["sendgrid", "ses"]).optional(),
	SENDGRID_API_KEY: optional,
	AWS_SES_REGION: optional,
	AWS_REGION: optional,
	AWS_ACCESS_KEY_ID: optional,
	AWS_SECRET_ACCESS_KEY: optional,
	WEBHOOK_SECRET: optional,
	ENCRYPTION_KEY: encryptionKey.optional(),
	/** Old keys, separated by commas. They still decrypt stored values. */
	ENCRYPTION_KEY_PREVIOUS: z
		.string()
		.optional()
		.transform((value) =>
			(value ?? "")
				.split(",")
				.map((key) => key.trim())
				.filter(Boolean),
		)
		.pipe(z.array(encryptionKey)),
	SEED_DEMO: z
		.string()
		.optional()
		.transform((value) => value === "true" || value === "1"),
});

type Env = z.infer<typeof envSchema>;

export function detectStoreKind(url: string | undefined): StoreKind {
	if (!url || url.startsWith("memory:")) {
		return "memory";
	}
	if (/^postgres(ql)?:/.test(url)) {
		return "postgres";
	}
	if (/^mongodb(\+srv)?:/.test(url)) {
		return "mongo";
	}
	throw new Error(
		`Unsupported DATABASE_URI scheme. Use postgres://, mongodb:// or memory://`,
	);
}

function emailProvider(env: Env): EmailProviderKind | undefined {
	return (
		env.EMAIL_PROVIDER ??
		(env.SENDGRID_API_KEY ? "sendgrid" : env.AWS_SES_REGION ? "ses" : undefined)
	);
}

/** Parses configuration from environment variables. */
export function loadConfig(
	source: Record<string, string | undefined> = process.env,
): Config {
	const parsed = envSchema.safeParse(withoutEmpty(source));
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("; ");
		throw new Error(`Invalid configuration: ${details}`);
	}
	const env = parsed.data;
	const awsRegion = env.AWS_SES_REGION ?? env.AWS_REGION;
	return {
		store: {
			kind: env.STORE ?? detectStoreKind(env.DATABASE_URI),
			url: env.DATABASE_URI,
			databaseName: env.DATABASE_NAME,
			tablePrefix: env.DATABASE_TABLE_PREFIX ?? "ic_",
			pool: env.DATABASE_POOL
				? env.DATABASE_POOL === "true"
				: !isCloudflareWorkers(),
		},
		cache: {
			ttl: env.CACHE_TTL,
			maxEntries: env.CACHE_MAX_ENTRIES ?? 5000,
		},
		siteUrl: env.SITE_URL?.replace(/\/+$/, ""),
		siteName: env.SITE_NAME ?? "Status",
		sessionTtl: env.SESSION_TTL,
		setupToken: env.SETUP_TOKEN,
		emailFrom: env.EMAIL_FROM,
		emailProvider: emailProvider(env),
		sendGridApiKey: env.SENDGRID_API_KEY,
		aws: awsRegion
			? {
					region: awsRegion,
					accessKeyId: env.AWS_ACCESS_KEY_ID,
					secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
				}
			: undefined,
		webhookSecret: env.WEBHOOK_SECRET,
		encryption: {
			key: env.ENCRYPTION_KEY,
			previousKeys: env.ENCRYPTION_KEY_PREVIOUS,
		},
		seedDemo: env.SEED_DEMO,
	};
}
