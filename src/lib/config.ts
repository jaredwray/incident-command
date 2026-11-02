import { shorthandToMilliseconds } from "cacheable";
import { z } from "zod";

export type StoreKind = "memory" | "postgres" | "mongo";

export interface EmailConfig {
	provider: "sendgrid" | "ses";
	from: string;
}

export interface Config {
	store: {
		kind: StoreKind;
		url?: string;
		databaseName?: string;
		tablePrefix: string;
	};
	cache: {
		ttl: number;
		maxEntries: number;
	};
	siteUrl?: string;
	siteName: string;
	sessionTtl: number;
	setupToken?: string;
	admin?: { email: string; password: string; name: string };
	email?: EmailConfig;
	twilio?: { accountSid: string; authToken: string; sendGridApiKey?: string };
	aws?: { region: string; accessKeyId?: string; secretAccessKey?: string };
	webhookSecret?: string;
}

const optional = z
	.string()
	.trim()
	.transform((value) => (value === "" ? undefined : value))
	.optional();

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
			const ms = parseDuration(value || fallback);
			if (ms === undefined) {
				ctx.addIssue({
					code: "custom",
					message: `Invalid duration "${value}"`,
				});
				return z.NEVER;
			}
			return ms;
		});

const envSchema = z.object({
	DATABASE_URL: optional,
	STORE: z.enum(["memory", "postgres", "mongo"]).optional(),
	DATABASE_NAME: optional,
	DATABASE_TABLE_PREFIX: optional,
	CACHE_TTL: duration("30s"),
	CACHE_MAX_ENTRIES: z.coerce.number().int().positive().optional(),
	SITE_URL: z
		.url()
		.optional()
		.or(z.literal("").transform(() => undefined)),
	SITE_NAME: optional,
	SESSION_TTL: duration("7d"),
	SETUP_TOKEN: optional,
	ADMIN_EMAIL: z
		.email()
		.optional()
		.or(z.literal("").transform(() => undefined)),
	ADMIN_PASSWORD: optional,
	ADMIN_NAME: optional,
	EMAIL_FROM: optional,
	EMAIL_PROVIDER: z.enum(["sendgrid", "ses"]).optional(),
	TWILIO_ACCOUNT_SID: optional,
	TWILIO_AUTH_TOKEN: optional,
	SENDGRID_API_KEY: optional,
	AWS_SES_REGION: optional,
	AWS_REGION: optional,
	AWS_ACCESS_KEY_ID: optional,
	AWS_SECRET_ACCESS_KEY: optional,
	WEBHOOK_SECRET: optional,
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
		`Unsupported DATABASE_URL scheme. Use postgres://, mongodb:// or memory://`,
	);
}

function emailConfig(env: Env): EmailConfig | undefined {
	if (!env.EMAIL_FROM) {
		return undefined;
	}
	const provider =
		env.EMAIL_PROVIDER ??
		(env.SENDGRID_API_KEY
			? "sendgrid"
			: env.AWS_SES_REGION
				? "ses"
				: undefined);
	return provider ? { provider, from: env.EMAIL_FROM } : undefined;
}

/** Parses configuration from environment variables. */
export function loadConfig(
	source: Record<string, string | undefined> = process.env,
): Config {
	const parsed = envSchema.safeParse(source);
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
			kind: env.STORE ?? detectStoreKind(env.DATABASE_URL),
			url: env.DATABASE_URL,
			databaseName: env.DATABASE_NAME,
			tablePrefix: env.DATABASE_TABLE_PREFIX ?? "ic_",
		},
		cache: {
			ttl: env.CACHE_TTL,
			maxEntries: env.CACHE_MAX_ENTRIES ?? 5000,
		},
		siteUrl: env.SITE_URL?.replace(/\/+$/, ""),
		siteName: env.SITE_NAME ?? "Status",
		sessionTtl: env.SESSION_TTL,
		setupToken: env.SETUP_TOKEN,
		admin:
			env.ADMIN_EMAIL && env.ADMIN_PASSWORD
				? {
						email: env.ADMIN_EMAIL,
						password: env.ADMIN_PASSWORD,
						name: env.ADMIN_NAME ?? "Admin",
					}
				: undefined,
		email: emailConfig(env),
		twilio:
			env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
				? {
						accountSid: env.TWILIO_ACCOUNT_SID,
						authToken: env.TWILIO_AUTH_TOKEN,
						sendGridApiKey: env.SENDGRID_API_KEY,
					}
				: undefined,
		aws: awsRegion
			? {
					region: awsRegion,
					accessKeyId: env.AWS_ACCESS_KEY_ID,
					secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
				}
			: undefined,
		webhookSecret: env.WEBHOOK_SECRET,
	};
}
