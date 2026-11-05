import { Airhorn, AirhornSendType } from "airhorn";
import { loadConfig } from "@/lib/config";
import type { Incident, Settings, Subscriber } from "@/lib/domain/types";
import {
	AirhornNotifier,
	createNotifier,
	createProviders,
} from "@/lib/notifications/notifier";
import {
	confirmUrl,
	emailData,
	type IncidentNotification,
	incidentUrl,
	summaryText,
	unsubscribeUrl,
	webhookPayload,
} from "@/lib/notifications/templates";
import { WebhookProvider } from "@/lib/notifications/webhook";

const twilioCtor = vi.fn();
const awsCtor = vi.fn();
vi.mock("@airhornjs/twilio", () => ({
	AirhornTwilio: class {
		name = "twilio";
		capabilities = ["sms", "email"];
		constructor(options: unknown) {
			twilioCtor(options);
		}
		async send() {
			return { success: true, response: {}, errors: [] };
		}
	},
}));
vi.mock("@airhornjs/aws", () => ({
	AirhornAws: class {
		name = "aws";
		capabilities: string[];
		constructor(options: { capabilities: string[] }) {
			awsCtor(options);
			this.capabilities = options.capabilities;
		}
		async send() {
			return { success: true, response: {}, errors: [] };
		}
	},
}));

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
	function setup(options: { email?: boolean; fail?: boolean | "throw" } = {}) {
		const sent: {
			to: string;
			content: string;
			subject?: string;
			type: string;
			options: unknown;
		}[] = [];
		const provider = {
			name: "fake",
			capabilities: [AirhornSendType.Email, AirhornSendType.Webhook],
			send: vi.fn(
				async (
					message: {
						to: string;
						content: string;
						subject?: string;
						type: string;
					},
					sendOptions: unknown,
				) => {
					if (options.fail === "throw") throw new Error("provider down");
					sent.push({ ...message, options: sendOptions });
					return options.fail
						? { success: false, response: {}, errors: [new Error("rejected")] }
						: { success: true, response: {}, errors: [] };
				},
			),
		};
		const airhorn = new Airhorn({
			providers: [provider],
			useWebhookProvider: false,
		});
		const errors: Error[] = [];
		const notifier = new AirhornNotifier({
			airhorn,
			email:
				options.email === false
					? undefined
					: { provider: "sendgrid", from: "status@acme.dev" },
			siteUrl: "https://status.acme.dev",
			onError: (error) => errors.push(error),
		});
		return { notifier, sent, errors, provider };
	}

	it("sends escaped emails and json webhooks to confirmed subscribers", async () => {
		const { notifier, sent } = setup();
		const result = await notifier.notifyIncident(notification, [
			subscriber(),
			subscriber({
				id: "sub_2",
				type: "webhook",
				target: "https://hooks.example.com/a",
			}),
			subscriber({
				id: "sub_3",
				confirmed: false,
				target: "pending@example.com",
			}),
		]);
		expect(result).toEqual({ sent: 2, failed: 0 });
		const email = sent.find((message) => message.type === "email");
		expect(email?.subject).toBe(
			"[Acme Status] New incident: API errors <script>",
		);
		expect(email?.content).toContain("API errors &lt;script&gt;");
		expect(email?.content).toContain("errors &amp; timeouts");
		expect(email?.content).toContain("https://status.acme.dev/incidents/inc_1");
		expect(email?.content).toContain("Unsubscribe");
		expect(email?.options).toMatchObject({
			text: expect.stringContaining("New incident"),
		});
		const webhook = sent.find((message) => message.type === "webhook");
		expect(JSON.parse(webhook?.content ?? "{}")).toMatchObject({
			event: "incident.created",
			incident: { id: "inc_1", url: "https://status.acme.dev/incidents/inc_1" },
		});
	});

	it("renders emails without links or services when unavailable", async () => {
		const { sent } = setup();
		const airhorn = new Airhorn({
			providers: [
				{
					name: "fake",
					capabilities: [AirhornSendType.Email],
					send: async (message) => {
						sent.push({ ...message, options: undefined });
						return { success: true, response: {}, errors: [] };
					},
				},
			],
			useWebhookProvider: false,
		});
		const notifier = new AirhornNotifier({
			airhorn,
			email: { provider: "ses", from: "a@b.co" },
		});
		await notifier.notifyIncident({ ...notification, services: [] }, [
			subscriber(),
		]);
		expect(sent[0]?.content).not.toContain("Affects");
		expect(sent[0]?.content).not.toContain("<a href");
	});

	it("skips email subscribers when email is disabled", async () => {
		const { notifier, sent } = setup({ email: false });
		expect(notifier.emailEnabled).toBe(false);
		const result = await notifier.notifyIncident(notification, [
			subscriber(),
			subscriber({
				id: "w",
				type: "webhook",
				target: "https://hooks.example.com/b",
			}),
		]);
		expect(result).toEqual({ sent: 1, failed: 0 });
		expect(sent).toHaveLength(1);
	});

	it("counts and reports failures", async () => {
		const { notifier, errors } = setup({ fail: true });
		const result = await notifier.notifyIncident(notification, [subscriber()]);
		expect(result).toEqual({ sent: 0, failed: 1 });
		expect(errors[0]?.message).toContain(
			"Failed to send email to jane@example.com",
		);
	});

	it("survives providers that throw", async () => {
		const { notifier, errors } = setup({ fail: "throw" });
		const result = await notifier.notifyIncident(notification, [subscriber()]);
		expect(result.failed).toBe(1);
		expect(errors.length).toBeGreaterThan(0);
	});

	it("reports exceptions thrown by airhorn itself", async () => {
		const errors: Error[] = [];
		const airhorn = {
			send: vi
				.fn()
				.mockRejectedValueOnce(new Error("kaput"))
				.mockRejectedValueOnce("odd"),
		} as unknown as Airhorn;
		const notifier = new AirhornNotifier({
			airhorn,
			email: { provider: "ses", from: "a@b.co" },
			onError: (e) => errors.push(e),
		});
		await notifier.notifyIncident(notification, [
			subscriber(),
			subscriber({ id: "2", target: "b@c.co" }),
		]);
		expect(errors.map((e) => e.message).sort()).toEqual(["kaput", "odd"]);
	});

	it("logs to the console by default", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const airhorn = {
			send: vi.fn().mockRejectedValue(new Error("kaput")),
		} as unknown as Airhorn;
		const notifier = new AirhornNotifier({
			airhorn,
			email: { provider: "ses", from: "a@b.co" },
		});
		await notifier.notifyIncident(notification, [subscriber()]);
		expect(spy).toHaveBeenCalledWith("[notifications] kaput");
		spy.mockRestore();
	});

	it("sends subscription confirmations", async () => {
		const { notifier, sent } = setup();
		await expect(
			notifier.sendConfirmation(subscriber({ confirmed: false }), settings),
		).resolves.toBe(true);
		expect(sent[0]?.subject).toBe("Confirm your subscription to Acme Status");
		expect(sent[0]?.content).toContain(
			"https://status.acme.dev/subscribe/confirm?token=tok%201",
		);
		await expect(
			notifier.sendConfirmation(subscriber({ type: "webhook" }), settings),
		).resolves.toBe(false);
		const disabled = setup({ email: false }).notifier;
		await expect(
			disabled.sendConfirmation(subscriber(), settings),
		).resolves.toBe(false);
	});

	it("handles an empty recipient list", async () => {
		const { notifier } = setup();
		await expect(notifier.notifyIncident(notification, [])).resolves.toEqual({
			sent: 0,
			failed: 0,
		});
	});
});

describe("createProviders / createNotifier", () => {
	it("always includes the webhook provider", async () => {
		const providers = await createProviders(loadConfig({}));
		expect(providers).toHaveLength(1);
		expect(providers[0]).toBeInstanceOf(WebhookProvider);
	});

	it("adds the twilio provider for sendgrid email", async () => {
		const config = loadConfig({
			EMAIL_FROM: "a@b.co",
			TWILIO_ACCOUNT_SID: "AC",
			TWILIO_AUTH_TOKEN: "t",
			SENDGRID_API_KEY: "SG",
		});
		const providers = await createProviders(config);
		expect(providers.map((p) => p.name)).toEqual([
			"incident-command-webhook",
			"twilio",
		]);
		expect(twilioCtor).toHaveBeenCalledWith({
			accountSid: "AC",
			authToken: "t",
			sendGridApiKey: "SG",
		});
		const notifier = await createNotifier(config);
		expect(notifier.emailEnabled).toBe(true);
	});

	it("adds the aws provider for ses email", async () => {
		const config = loadConfig({
			EMAIL_FROM: "a@b.co",
			AWS_SES_REGION: "us-west-2",
		});
		const providers = await createProviders(config);
		expect(providers.map((p) => p.name)).toEqual([
			"incident-command-webhook",
			"aws",
		]);
		expect(awsCtor).toHaveBeenCalledWith(
			expect.objectContaining({ region: "us-west-2", capabilities: ["email"] }),
		);
	});

	it("disables email when the provider cannot be built", async () => {
		const config = loadConfig({ EMAIL_FROM: "a@b.co", SENDGRID_API_KEY: "SG" });
		expect(config.email?.provider).toBe("sendgrid");
		const notifier = await createNotifier(config);
		expect(notifier.emailEnabled).toBe(false);
		const ses = loadConfig({ EMAIL_FROM: "a@b.co", EMAIL_PROVIDER: "ses" });
		expect((await createProviders(ses)).map((p) => p.name)).toEqual([
			"incident-command-webhook",
		]);
	});
});

describe("lazy airhorn", () => {
	it("creates airhorn on first send and reuses it", async () => {
		const send = vi.fn(async () => ({ success: true, errors: [] }));
		const factory = vi.fn(async () => ({ send }) as unknown as Airhorn);
		const notifier = new AirhornNotifier({
			airhorn: factory,
			email: { provider: "ses", from: "a@b.co" },
		});
		expect(factory).not.toHaveBeenCalled();
		await notifier.notifyIncident(notification, [
			subscriber(),
			subscriber({ id: "2", target: "b@c.co" }),
		]);
		await notifier.sendConfirmation(subscriber({ confirmed: false }), settings);
		expect(factory).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledTimes(3);
	});

	it("reports when airhorn cannot be loaded (e.g. on Cloudflare Workers)", async () => {
		const errors: Error[] = [];
		const notifier = new AirhornNotifier({
			airhorn: () =>
				Promise.reject(new Error("Code generation from strings disallowed")),
			email: { provider: "ses", from: "a@b.co" },
			onError: (error) => errors.push(error),
		});
		await expect(
			notifier.notifyIncident(notification, [subscriber()]),
		).resolves.toEqual({ sent: 0, failed: 1 });
		expect(errors[0]?.message).toContain("Code generation");
	});

	it("loads real providers through createNotifier", async () => {
		const notifier = createNotifier(loadConfig({ WEBHOOK_SECRET: "s" }));
		const instance = await notifier.airhorn();
		expect(instance.providers.map((provider) => provider.name)).toEqual([
			"incident-command-webhook",
		]);
		expect(await notifier.airhorn()).toBe(instance);
	});

	it("knows when email is available", async () => {
		const { emailAvailable } = await import("@/lib/notifications/notifier");
		expect(emailAvailable(loadConfig({}))).toBe(false);
		expect(
			emailAvailable(
				loadConfig({ EMAIL_FROM: "a@b.co", SENDGRID_API_KEY: "SG" }),
			),
		).toBe(false);
		expect(
			emailAvailable(
				loadConfig({
					EMAIL_FROM: "a@b.co",
					SENDGRID_API_KEY: "SG",
					TWILIO_ACCOUNT_SID: "AC",
					TWILIO_AUTH_TOKEN: "t",
				}),
			),
		).toBe(true);
		expect(
			emailAvailable(
				loadConfig({ EMAIL_FROM: "a@b.co", EMAIL_PROVIDER: "ses" }),
			),
		).toBe(false);
		expect(
			emailAvailable(
				loadConfig({ EMAIL_FROM: "a@b.co", AWS_SES_REGION: "us-east-1" }),
			),
		).toBe(true);
	});
});
