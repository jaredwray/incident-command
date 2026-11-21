import type { AirhornAws } from "@airhornjs/aws";
import type { AirhornTwilio } from "@airhornjs/twilio";
import type { AirhornProviderMessage } from "airhorn";
import { loadConfig } from "@/lib/config";
import { hmacSha256 } from "@/lib/crypto";
import type { Incident, Settings, Subscriber } from "@/lib/domain/types";
import type {
	DeliveryChannel,
	DeliveryChannels,
	ResolvedProvider,
} from "@/lib/notifications/delivery";
import { AirhornNotifier, createNotifier } from "@/lib/notifications/notifier";
import { ChannelProvider, createProvider } from "@/lib/notifications/providers";
import { SENDGRID_URL } from "@/lib/notifications/sendgrid";
import {
	confirmationText,
	confirmUrl,
	emailData,
	type IncidentNotification,
	incidentUrl,
	SMS_MAX_LENGTH,
	smsText,
	subscriptionServicesUrl,
	summaryText,
	unsubscribeUrl,
	webhookPayload,
} from "@/lib/notifications/templates";
import { SIGNATURE_HEADER } from "@/lib/notifications/webhook";

type SdkResult = { success: boolean; response: unknown; errors: Error[] };
const sdk = vi.hoisted(() => ({
	twilioCtor: vi.fn(),
	awsCtor: vi.fn(),
	sends: [] as { sdk: string; message: unknown; options: unknown }[],
	result: (): SdkResult => ({ success: true, response: {}, errors: [] }),
}));
// The real provider packages, with their sends recorded. Their constructors
// check the options. Vitest loads them with plain Node, as the server does.
vi.mock("@airhornjs/twilio", async (importOriginal) => {
	const actual = await importOriginal<{
		AirhornTwilio: typeof AirhornTwilio;
	}>();
	return {
		AirhornTwilio: class extends actual.AirhornTwilio {
			constructor(options: ConstructorParameters<typeof AirhornTwilio>[0]) {
				super(options);
				sdk.twilioCtor(options);
			}
			override async send(message: AirhornProviderMessage, options: unknown) {
				sdk.sends.push({ sdk: "twilio", message, options });
				return sdk.result();
			}
		},
	};
});
vi.mock("@airhornjs/aws", async (importOriginal) => {
	const actual = await importOriginal<{ AirhornAws: typeof AirhornAws }>();
	return {
		AirhornAws: class extends actual.AirhornAws {
			constructor(options: ConstructorParameters<typeof AirhornAws>[0]) {
				super(options);
				sdk.awsCtor(options);
			}
			override async send(message: AirhornProviderMessage, options: unknown) {
				sdk.sends.push({ sdk: "aws", message, options });
				return sdk.result();
			}
		},
	};
});

const requests: { url: string; init: RequestInit }[] = [];
let respond: (url: string) => Response = () =>
	new Response(null, { status: 202 });

beforeEach(() => {
	requests.length = 0;
	sdk.sends.length = 0;
	sdk.result = () => ({ success: true, response: {}, errors: [] });
	respond = () => new Response(null, { status: 202 });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit) => {
			requests.push({ url: String(url), init });
			return respond(String(url));
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const DEFAULTS: Record<ResolvedProvider["type"], Partial<ResolvedProvider>> = {
	webhook: { secrets: { signingSecret: "whsec" } },
	sendgrid: { from: "Acme <status@acme.dev>", secrets: { apiKey: "SG.key" } },
	ses: { from: "status@acme.dev", options: { region: "us-east-1" } },
	twilio: {
		from: "+15550001111",
		options: { accountSid: `AC${"0".repeat(32)}` },
		secrets: { authToken: "tok" },
	},
	sns: { from: "ACME", options: { region: "eu-west-1" } },
};

function provider(
	type: ResolvedProvider["type"],
	overrides: Partial<ResolvedProvider> = {},
): ResolvedProvider {
	return {
		id: `prv_${type}`,
		type,
		name: `${type} provider`,
		options: {},
		secrets: {},
		...DEFAULTS[type],
		...overrides,
	};
}

function channel(
	name: DeliveryChannel["channel"],
	providers: ResolvedProvider[],
	overrides: Partial<DeliveryChannel> = {},
): DeliveryChannel {
	return {
		channel: name,
		enabled: true,
		strategy: "active_passive",
		providers,
		version: "v1",
		...overrides,
	};
}

function channels(overrides: Partial<DeliveryChannels> = {}): DeliveryChannels {
	return {
		webhook: channel("webhook", [provider("webhook")]),
		email: channel("email", [provider("sendgrid")]),
		sms: channel("sms", [provider("twilio")]),
		...overrides,
	};
}

function headers(request: { init: RequestInit } | undefined) {
	return (request?.init.headers ?? {}) as Record<string, string>;
}

function body(request: { init: RequestInit } | undefined) {
	return JSON.parse(String(request?.init.body));
}

function notifier() {
	const errors: Error[] = [];
	const instance = new AirhornNotifier({
		siteUrl: "https://status.acme.dev",
		onError: (error) => errors.push(error),
	});
	return { notifier: instance, errors };
}

const settings: Settings = {
	id: "settings",
	siteName: "Acme Status",
	description: "",
	theme: "default",
	showPoweredBy: true,
	requireTwoFactor: true,
	uptimeDays: 90,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const incident: Incident = {
	id: "inc_1",
	kind: "incident",
	title: "API errors <script>",
	status: "investigating",
	impact: "major",
	serviceIds: ["svc_1"],
	updates: [],
	startedAt: "2026-11-02T10:00:00.000Z",
	createdBy: { type: "agent", id: "agt_1", name: "Bot" },
	createdAt: "2026-11-02T10:00:00.000Z",
	updatedAt: "2026-11-02T10:00:00.000Z",
};

const update = {
	id: "upd_1",
	title: "API errors <script>",
	impact: "major" as const,
	status: "investigating" as const,
	message: "We are looking into elevated errors & timeouts.",
	author: { type: "agent" as const, id: "agt_1", name: "Bot" },
	createdAt: "2026-11-02T10:00:00.000Z",
};

const notification: IncidentNotification = {
	event: "incident.created",
	incident,
	update,
	settings,
	services: [
		{
			id: "svc_1",
			name: "API",
			status: "partial_outage",
			order: 0,
			hidden: false,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
	],
};

const subscriber = (overrides: Partial<Subscriber> = {}): Subscriber => ({
	id: "sub_1",
	type: "email",
	target: "jane@example.com",
	confirmed: true,
	token: "tok 1",
	createdAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

describe("templates", () => {
	it("builds urls from settings or the configured fallback", () => {
		expect(incidentUrl(notification)).toBeUndefined();
		expect(
			incidentUrl({ ...notification, siteUrl: "https://s.example.com/" }),
		).toBe("https://s.example.com/incidents/inc_1");
		const withSite = { ...settings, siteUrl: "https://status.acme.dev" };
		expect(
			incidentUrl({
				...notification,
				settings: withSite,
				siteUrl: "https://ignored",
			}),
		).toBe("https://status.acme.dev/incidents/inc_1");
		expect(unsubscribeUrl(subscriber(), withSite)).toBe(
			"https://status.acme.dev/subscribe/unsubscribe?token=tok%201",
		);
		expect(subscriptionServicesUrl(subscriber(), withSite)).toBe(
			"https://status.acme.dev/subscribe/services?token=tok%201",
		);
		expect(subscriptionServicesUrl(subscriber(), settings)).toBeUndefined();
		expect(confirmUrl(subscriber(), settings, "https://f.example.com")).toBe(
			"https://f.example.com/subscribe/confirm?token=tok%201",
		);
		expect(confirmUrl(subscriber(), settings)).toBeUndefined();
		// Without a site URL, a text confirmation has no link line.
		expect(confirmationText(subscriber(), settings)).toBe(
			"[Acme Status] Confirm your subscription to status updates.",
		);
	});

	it("summarizes for chat webhooks", () => {
		expect(summaryText(notification)).toBe(
			"[Acme Status] New incident: API errors <script>\nInvestigating: We are looking into elevated errors & timeouts.",
		);
		expect(
			summaryText({
				...notification,
				event: "maintenance.completed",
				siteUrl: "https://x.co",
			}),
		).toContain("Maintenance completed");
		expect(
			summaryText({ ...notification, siteUrl: "https://x.co" }).split("\n")[2],
		).toBe("https://x.co/incidents/inc_1");
		expect(
			summaryText({
				...notification,
				incident: { ...incident, title: "Old title" },
				update: { ...update, title: "New title" },
			}),
		).toContain("New incident: New title");
	});

	it("fits text messages in SMS_MAX_LENGTH characters and keeps the link whole", () => {
		const url = "https://status.acme.dev";
		const link = "https://status.acme.dev/incidents/inc_1";
		const short = smsText({ ...notification, siteUrl: url });
		expect(short).toBe(
			`[Acme Status] New incident: API errors <script>\nInvestigating: We are looking into elevated errors & timeouts.\n${link}`,
		);
		const long = smsText({
			...notification,
			siteUrl: url,
			update: { ...update, message: "word ".repeat(200) },
		});
		expect(long.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
		expect(long).not.toContain("…");
		expect(long.endsWith(`...\n${link}`)).toBe(true);

		// A long site name and title are cut, so the status still fits.
		const longHeader = {
			settings: { ...settings, siteName: "S".repeat(120) },
			update: { ...update, title: "T".repeat(200) },
		};
		const huge = smsText({ ...notification, ...longHeader, siteUrl: url });
		expect(huge).toHaveLength(SMS_MAX_LENGTH);
		const [head, status, tail] = huge.split("\n");
		expect(head?.endsWith("T...")).toBe(true);
		expect(status).toBe(
			"Investigating: We are looking into elevated errors & timeouts.",
		);
		expect(tail).toBe(link);
		const both = smsText({
			...notification,
			...longHeader,
			update: { ...update, message: "word ".repeat(200) },
		});
		expect(both.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
		expect(both.split("\n")[1]?.length).toBeGreaterThanOrEqual(99);
	});

	it("builds email data and webhook payloads", () => {
		const data = emailData(
			{ ...notification, siteUrl: "https://x.co" },
			subscriber(),
		);
		expect(data).toMatchObject({
			siteName: "Acme Status",
			prefix: "New incident",
			title: "API errors <script>",
			statusLabel: "Investigating",
			services: "API",
			incidentUrl: "https://x.co/incidents/inc_1",
			unsubscribeUrl: "https://x.co/subscribe/unsubscribe?token=tok%201",
			servicesUrl: "https://x.co/subscribe/services?token=tok%201",
		});
		const payload = webhookPayload(notification);
		expect(payload.event).toBe("incident.created");
		expect(payload.text).toBe(payload.content);
		expect(payload.incident.services).toEqual([
			{ id: "svc_1", name: "API", status: "partial_outage" },
		]);
		expect(payload.page).toEqual({ name: "Acme Status", url: undefined });
		expect(payload.update).toMatchObject({
			title: update.title,
			impact: update.impact,
			message: update.message,
		});
		const renamed = webhookPayload({
			...notification,
			incident: { ...incident, title: "Old title", impact: "minor" },
			update: { ...update, title: "New title", impact: "critical" },
		});
		expect(renamed.update).toMatchObject({
			title: "New title",
			impact: "critical",
		});
		expect(renamed.incident).toMatchObject({
			title: "Old title",
			impact: "minor",
		});
		expect(
			emailData(
				{
					...notification,
					siteUrl: "https://x.co",
					update: { ...update, title: "New title", impact: "critical" },
				},
				subscriber(),
			).title,
		).toBe("New title");
		expect(payload.incident.regionIds).toEqual([]);
		expect(
			webhookPayload({
				...notification,
				incident: { ...incident, regionId: "reg_us" },
			}).incident.regionIds,
		).toEqual(["reg_us"]);
		expect(
			webhookPayload({
				...notification,
				incident: {
					...incident,
					serviceIds: ["svc_1", "svc_2"],
					serviceRegions: [
						{ serviceId: "svc_1", regionIds: ["reg_us", "reg_eu"] },
					],
				},
			}).incident.regionIds,
		).toEqual(["reg_us", "reg_eu"]);
	});
});

describe("AirhornNotifier", () => {
	it("sends escaped emails, signed webhooks and text messages to confirmed subscribers", async () => {
		const { notifier: n, errors } = notifier();
		const reported: { id: string; ok: boolean }[] = [];
		const result = await n.notifyIncident(
			notification,
			[
				subscriber(),
				subscriber({
					id: "sub_2",
					type: "webhook",
					target: "https://hooks.example.com/a",
				}),
				subscriber({ id: "sub_3", type: "sms", target: "+15551234567" }),
				subscriber({
					id: "sub_4",
					confirmed: false,
					target: "pending@example.com",
				}),
			],
			channels(),
			async (person, ok) => {
				reported.push({ id: person.id, ok });
			},
		);
		expect(errors).toEqual([]);
		expect(result).toEqual({ sent: 3, failed: 0 });
		expect(reported).toEqual(
			expect.arrayContaining([
				{ id: "sub_1", ok: true },
				{ id: "sub_2", ok: true },
				{ id: "sub_3", ok: true },
			]),
		);
		expect(reported).toHaveLength(3);

		const email = requests.find((request) => request.url === SENDGRID_URL);
		expect(headers(email).authorization).toBe("Bearer SG.key");
		const mail = body(email);
		expect(mail.personalizations).toEqual([
			{ to: [{ email: "jane@example.com" }] },
		]);
		expect(mail.from).toEqual({ name: "Acme", email: "status@acme.dev" });
		expect(mail.subject).toBe(
			"[Acme Status] New incident: API errors <script>",
		);
		const [plain, html] = mail.content;
		expect(plain.value).toContain("New incident");
		expect(html.value).toContain("API errors &lt;script&gt;");
		expect(html.value).toContain("errors &amp; timeouts");
		expect(html.value).toContain("https://status.acme.dev/incidents/inc_1");
		expect(html.value).toContain("Unsubscribe");
		expect(html.value).toContain(
			"https://status.acme.dev/subscribe/services?token=tok%201",
		);
		expect(html.value).toContain("Choose services");

		const hook = requests.find(
			(request) => request.url === "https://hooks.example.com/a",
		);
		expect(body(hook)).toMatchObject({
			event: "incident.created",
			incident: { id: "inc_1", url: "https://status.acme.dev/incidents/inc_1" },
		});
		expect(headers(hook)[SIGNATURE_HEADER]).toBe(
			`sha256=${hmacSha256("whsec", String(hook?.init.body))}`,
		);

		// SMS gets no provider options: the SNS provider copies them into its request.
		expect(sdk.sends).toEqual([
			{
				sdk: "twilio",
				message: expect.objectContaining({
					to: "+15551234567",
					from: "+15550001111",
					type: "sms",
					content: smsText({
						...notification,
						siteUrl: "https://status.acme.dev",
					}),
				}),
				options: undefined,
			},
		]);
	});

	it("posts to a private webhook address only when the channel allows it", async () => {
		const internal = subscriber({
			type: "webhook",
			target: "http://10.0.0.5/hook",
		});
		const blocked = await notifier().notifier.notifyIncident(
			notification,
			[internal],
			channels(),
		);
		expect(blocked).toEqual({ sent: 0, failed: 1 });
		expect(requests).toEqual([]);
		const allowed = await notifier().notifier.notifyIncident(
			notification,
			[internal],
			channels({
				webhook: channel("webhook", [provider("webhook")], {
					allowPrivateNetworks: true,
				}),
			}),
		);
		expect(allowed).toEqual({ sent: 1, failed: 0 });
		expect(requests.map((request) => request.url)).toEqual([
			"http://10.0.0.5/hook",
		]);
	});

	it("renders emails without links or services when unavailable", async () => {
		const n = new AirhornNotifier();
		await n.notifyIncident(
			{ ...notification, services: [] },
			[subscriber()],
			channels(),
		);
		const [, html] = body(requests[0]).content;
		expect(html.value).not.toContain("Affects");
		expect(html.value).not.toContain("<a href");
	});

	it("skips subscribers whose channel is off or has no providers", async () => {
		const { notifier: n } = notifier();
		const result = await n.notifyIncident(
			notification,
			[
				subscriber(),
				subscriber({
					id: "w",
					type: "webhook",
					target: "https://h.example.com",
				}),
				subscriber({ id: "s", type: "sms", target: "+15551234567" }),
			],
			channels({
				email: channel("email", [provider("sendgrid")], { enabled: false }),
				sms: channel("sms", []),
			}),
		);
		expect(result).toEqual({ sent: 1, failed: 0 });
		expect(requests.map((request) => request.url)).toEqual([
			"https://h.example.com",
		]);
	});

	it("uses the next provider when the active one fails (active/passive)", async () => {
		respond = () => new Response("down", { status: 503 });
		const { notifier: n, errors } = notifier();
		const result = await n.notifyIncident(notification, [subscriber()], {
			...channels(),
			email: channel("email", [provider("sendgrid"), provider("ses")]),
		});
		expect(result).toEqual({ sent: 1, failed: 0 });
		expect(errors).toEqual([]);
		expect(requests.map((request) => request.url)).toEqual([SENDGRID_URL]);
		expect(sdk.sends).toEqual([
			expect.objectContaining({
				sdk: "aws",
				message: expect.objectContaining({ from: "status@acme.dev" }),
			}),
		]);
	});

	it("sends through each provider in turn and keeps the turn between sends (load balanced)", async () => {
		const { notifier: n } = notifier();
		const sms = channel("sms", [provider("twilio"), provider("sns")], {
			strategy: "load_balanced",
		});
		const phones = [
			subscriber({ id: "a", type: "sms", target: "+15550000001" }),
			subscriber({ id: "b", type: "sms", target: "+15550000002" }),
		];
		await n.notifyIncident(notification, phones, { ...channels(), sms });
		await n.notifyIncident(notification, phones.slice(0, 1), {
			...channels(),
			sms,
		});
		expect(sdk.sends.map((send) => send.sdk).sort()).toEqual([
			"aws",
			"twilio",
			"twilio",
		]);
		expect(
			sdk.sends
				.filter((send) => send.sdk === "aws")
				.map((send) => (send.message as AirhornProviderMessage).from),
		).toEqual(["ACME"]);
	});

	it("names the failed provider in the error", async () => {
		respond = () => new Response("bad key", { status: 401 });
		const { notifier: n, errors } = notifier();
		const reported: boolean[] = [];
		const result = await n.notifyIncident(
			notification,
			[subscriber()],
			channels(),
			async (_person, ok) => {
				reported.push(ok);
			},
		);
		expect(result).toEqual({ sent: 0, failed: 1 });
		expect(reported).toEqual([false]);
		expect(errors.map((error) => error.message)).toEqual([
			"Failed to send email to jane@example.com: sendgrid provider: SendGrid responded with status 401",
		]);
	});

	it("reports load-balanced failures from the provider response", async () => {
		const { notifier: n, errors } = notifier();
		const sms = channel("sms", [provider("twilio")], {
			strategy: "load_balanced",
		});
		const phone = subscriber({ type: "sms", target: "+15551234567" });
		sdk.result = () => ({
			success: false,
			response: {},
			errors: [new Error("invalid number")],
		});
		await n.notifyIncident(notification, [phone], { ...channels(), sms });
		sdk.result = () => ({ success: false, response: {}, errors: [] });
		await n.notifyIncident(notification, [phone], { ...channels(), sms });
		expect(errors.map((error) => error.message)).toEqual([
			"Failed to send sms to +15551234567: twilio provider: invalid number",
			"Failed to send sms to +15551234567: the provider gave no reason",
		]);
	});

	it("leaves out providers that cannot be built", async () => {
		const { notifier: n, errors } = notifier();
		const broken = provider("twilio", {
			name: "Broken",
			options: { accountSid: "broken" },
		});
		const phone = subscriber({ type: "sms", target: "+15551234567" });
		await expect(
			n.notifyIncident(notification, [phone], {
				...channels(),
				sms: channel("sms", [broken, provider("sns")]),
			}),
		).resolves.toEqual({ sent: 1, failed: 0 });
		await expect(
			n.notifyIncident(notification, [phone], {
				...channels(),
				sms: channel("sms", [broken], { version: "v2" }),
			}),
		).resolves.toEqual({ sent: 0, failed: 1 });
		expect(errors.map((error) => error.message)).toEqual([
			'Cannot use provider "Broken": accountSid must start with AC',
			'Cannot use provider "Broken": accountSid must start with AC',
			"Failed to send sms to +15551234567: No providers available for type: sms",
		]);
	});

	it("keeps one airhorn instance per channel until the settings change", async () => {
		const { notifier: n } = notifier();
		const email = channel("email", [provider("sendgrid")]);
		// The first sends of a batch start together and must share one instance.
		const [first, again] = await Promise.all([
			n.airhorn(email),
			n.airhorn(email),
		]);
		expect(again).toBe(first);
		expect(await n.airhorn(email)).toBe(first);
		const changed = await n.airhorn(
			channel("email", [provider("ses")], { version: "v2" }),
		);
		expect(changed).not.toBe(first);
		expect(changed.sendStrategy).toBe("FailOver");
		// The render cache has no size limit, so it must stay off.
		expect(changed.cache).toBeUndefined();
		expect(
			(await n.airhorn(channel("sms", [], { strategy: "load_balanced" })))
				.sendStrategy,
		).toBe("RoundRobin");
	});

	it("logs to the console by default", async () => {
		respond = () => new Response("bad key", { status: 401 });
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const n = new AirhornNotifier();
		await n.notifyIncident(notification, [subscriber()], channels());
		expect(spy).toHaveBeenCalledWith(
			"[notifications] Failed to send email to jane@example.com: sendgrid provider: SendGrid responded with status 401",
		);
	});

	it("sends subscription confirmations through the channel of the subscriber", async () => {
		const { notifier: n } = notifier();
		const email = channels().email;
		await expect(
			n.sendConfirmation(subscriber({ confirmed: false }), settings, email),
		).resolves.toBe(true);
		const mail = body(requests[0]);
		expect(mail.subject).toBe("Confirm your subscription to Acme Status");
		expect(mail.content[1].value).toContain(
			"https://status.acme.dev/subscribe/confirm?token=tok%201",
		);
		await expect(
			n.sendConfirmation(subscriber({ type: "webhook" }), settings, email),
		).resolves.toBe(false);
		await expect(
			n.sendConfirmation(subscriber(), settings, { ...email, enabled: false }),
		).resolves.toBe(false);
		expect(requests).toHaveLength(1);

		const link = "https://status.acme.dev/subscribe/confirm?token=tok%201";
		const text = `[Acme Status] Confirm your subscription to status updates.\n${link}`;
		await expect(
			n.sendConfirmation(
				subscriber({ type: "sms", target: "+15551234567", confirmed: false }),
				settings,
				channels().sms,
			),
		).resolves.toBe(true);
		expect(sdk.sends).toEqual([
			{
				sdk: "twilio",
				message: expect.objectContaining({ to: "+15551234567", content: text }),
				options: undefined,
			},
		]);

		await expect(
			n.sendConfirmation(
				subscriber({
					type: "webhook",
					target: "https://hooks.example.com/a",
					confirmed: false,
				}),
				settings,
				channels().webhook,
			),
		).resolves.toBe(true);
		const hook = requests[1];
		expect(hook?.url).toBe("https://hooks.example.com/a");
		expect(body(hook)).toMatchObject({
			event: "subscription.confirm",
			text,
			content: text,
			confirmUrl: link,
			page: { name: "Acme Status", url: "https://status.acme.dev" },
		});
		expect(headers(hook)[SIGNATURE_HEADER]).toBe(
			`sha256=${hmacSha256("whsec", String(hook?.init.body))}`,
		);
	});

	it("handles an empty recipient list", async () => {
		const { notifier: n } = notifier();
		await expect(
			n.notifyIncident(notification, [], channels()),
		).resolves.toEqual({ sent: 0, failed: 0 });
	});

	it("loads airhorn and the real webhook provider through createNotifier", async () => {
		const n = createNotifier(loadConfig({ SITE_URL: "https://s.example.com" }));
		const instance = await n.airhorn(
			channel("webhook", [provider("webhook", { name: "Built-in" })]),
		);
		expect(instance.providers.map((item) => item.name)).toEqual(["Built-in"]);
		expect(instance.providers[0]?.capabilities).toEqual(["webhook"]);
	});
});

describe("createProvider", () => {
	it("builds the AWS providers for SES and SNS", () => {
		createProvider(
			provider("ses", {
				options: { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
				secrets: { secretAccessKey: "secret" },
			}),
		);
		createProvider(provider("sns"));
		expect(sdk.awsCtor.mock.calls).toEqual([
			[
				{
					region: "us-east-1",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "secret",
					capabilities: ["email"],
				},
			],
			[
				{
					region: "eu-west-1",
					accessKeyId: undefined,
					secretAccessKey: undefined,
					capabilities: ["sms"],
				},
			],
		]);
	});

	it("builds the Twilio provider", () => {
		createProvider(provider("twilio"));
		expect(sdk.twilioCtor).toHaveBeenCalledWith({
			accountSid: `AC${"0".repeat(32)}`,
			authToken: "tok",
		});
	});
});

describe("ChannelProvider", () => {
	it("replaces the sender only when the provider has one", async () => {
		const inner = {
			name: "inner",
			capabilities: [],
			send: vi.fn(async () => ({ success: true, response: {}, errors: [] })),
		};
		const message = {
			to: "a@b.co",
			from: "channel@acme.dev",
			content: "x",
			type: "email" as AirhornProviderMessage["type"],
		};
		await new ChannelProvider("Mine", message.type, inner, "own@acme.dev").send(
			message,
			{ text: "t" },
		);
		await new ChannelProvider("Mine", message.type, inner).send(message);
		expect(inner.send.mock.calls).toEqual([
			[{ ...message, from: "own@acme.dev" }, { text: "t" }],
			[message, undefined],
		]);
	});
});
