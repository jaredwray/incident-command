import { Airhorn, type AirhornProviderMessage } from "airhorn";
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
	confirmUrl,
	emailData,
	type IncidentNotification,
	incidentUrl,
	SMS_MAX_LENGTH,
	smsText,
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
vi.mock("@airhornjs/twilio", () => ({
	AirhornTwilio: class {
		name = "twilio";
		capabilities = ["sms", "email"];
		constructor(options: { accountSid: string }) {
			if (options.accountSid === "broken") {
				throw new Error("accountSid must start with AC");
			}
			sdk.twilioCtor(options);
		}
		async send(message: unknown, options: unknown) {
			sdk.sends.push({ sdk: "twilio", message, options });
			return sdk.result();
		}
	},
}));
vi.mock("@airhornjs/aws", () => ({
	AirhornAws: class {
		name = "aws";
		capabilities: string[];
		constructor(options: { capabilities: string[] }) {
			sdk.awsCtor(options);
			this.capabilities = options.capabilities;
		}
		async send(message: unknown, options: unknown) {
			sdk.sends.push({ sdk: "aws", message, options });
			return sdk.result();
		}
	},
}));

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
	allowSubscriptions: true,
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
		expect(confirmUrl(subscriber(), settings, "https://f.example.com")).toBe(
			"https://f.example.com/subscribe/confirm?token=tok%201",
		);
		expect(confirmUrl(subscriber(), settings)).toBeUndefined();
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
			incident: { ...incident, title: "T".repeat(200) },
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
			statusLabel: "Investigating",
			services: "API",
			incidentUrl: "https://x.co/incidents/inc_1",
			unsubscribeUrl: "https://x.co/subscribe/unsubscribe?token=tok%201",
		});
		const payload = webhookPayload(notification);
		expect(payload.event).toBe("incident.created");
		expect(payload.text).toBe(payload.content);
		expect(payload.incident.services).toEqual([
			{ id: "svc_1", name: "API", status: "partial_outage" },
		]);
		expect(payload.page).toEqual({ name: "Acme Status", url: undefined });
		expect(payload.update.message).toBe(update.message);
	});
});

describe("AirhornNotifier", () => {
	it("sends escaped emails, signed webhooks and text messages to confirmed subscribers", async () => {
		const { notifier: n, errors } = notifier();
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
		);
		expect(errors).toEqual([]);
		expect(result).toEqual({ sent: 3, failed: 0 });

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
		const result = await n.notifyIncident(
			notification,
			[subscriber()],
			channels(),
		);
		expect(result).toEqual({ sent: 0, failed: 1 });
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
		const first = n.airhorn(channel("email", [provider("sendgrid")]));
		expect(n.airhorn(channel("email", [provider("sendgrid")]))).toBe(first);
		const changed = n.airhorn(
			channel("email", [provider("ses")], { version: "v2" }),
		);
		expect(changed).not.toBe(first);
		expect((await changed).sendStrategy).toBe("FailOver");
		expect(
			(await n.airhorn(channel("sms", [], { strategy: "load_balanced" })))
				.sendStrategy,
		).toBe("RoundRobin");
	});

	it("reports and retries when airhorn cannot be loaded (e.g. on Cloudflare Workers)", async () => {
		const errors: Error[] = [];
		const createAirhorn = vi
			.fn<() => Promise<Airhorn>>()
			.mockRejectedValueOnce(
				new Error("Code generation from strings disallowed"),
			)
			.mockRejectedValueOnce("odd")
			.mockResolvedValue(new Airhorn({ useWebhookProvider: false }));
		const n = new AirhornNotifier({
			createAirhorn,
			onError: (error) => errors.push(error),
		});
		// airhorn loads on the first send, not at startup.
		expect(createAirhorn).not.toHaveBeenCalled();
		const email = channels();
		await expect(
			n.notifyIncident(notification, [subscriber()], email),
		).resolves.toEqual({ sent: 0, failed: 1 });
		await n.notifyIncident(notification, [subscriber()], email);
		await n.notifyIncident(notification, [subscriber()], email);
		await n.notifyIncident(notification, [subscriber()], email);
		expect(createAirhorn).toHaveBeenCalledTimes(3);
		expect(errors.map((error) => error.message)).toEqual([
			"Code generation from strings disallowed",
			"odd",
			"Failed to send email to jane@example.com: No providers available for type: email",
			"Failed to send email to jane@example.com: No providers available for type: email",
		]);
	});

	it("keeps a newer airhorn instance when an older load fails", async () => {
		let failOld: (error: Error) => void = () => {};
		const createAirhorn = vi
			.fn<() => Promise<Airhorn>>()
			.mockReturnValueOnce(
				new Promise((_resolve, reject) => {
					failOld = reject;
				}),
			)
			.mockResolvedValueOnce(new Airhorn({ useWebhookProvider: false }));
		const n = new AirhornNotifier({ createAirhorn });
		const old = n.airhorn(channel("email", [], { version: "v1" }));
		const current = n.airhorn(channel("email", [], { version: "v2" }));
		failOld(new Error("boom"));
		await expect(old).rejects.toThrow("boom");
		expect(n.airhorn(channel("email", [], { version: "v2" }))).toBe(current);
		expect(createAirhorn).toHaveBeenCalledTimes(2);
	});

	it("logs to the console by default", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const n = new AirhornNotifier({
			createAirhorn: () => Promise.reject(new Error("kaput")),
		});
		await n.notifyIncident(notification, [subscriber()], channels());
		expect(spy).toHaveBeenCalledWith("[notifications] kaput");
	});

	it("sends subscription confirmations through the email channel", async () => {
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
	it("passes the timeout and secret to the webhook provider", async () => {
		const timeout = vi.spyOn(AbortSignal, "timeout");
		const webhook = await createProvider(
			provider("webhook", { options: { timeoutSeconds: "5" }, secrets: {} }),
		);
		await webhook.send({
			to: "https://h.example.com",
			from: "",
			content: "{}",
			type: "webhook" as AirhornProviderMessage["type"],
		});
		expect(timeout).toHaveBeenCalledWith(5000);
		expect(headers(requests[0])[SIGNATURE_HEADER]).toBeUndefined();
	});

	it("builds the AWS providers for SES and SNS", async () => {
		await createProvider(
			provider("ses", {
				options: { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
				secrets: { secretAccessKey: "secret" },
			}),
		);
		await createProvider(provider("sns"));
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

	it("builds the Twilio provider", async () => {
		await createProvider(provider("twilio"));
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
