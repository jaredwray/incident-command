import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@/lib/errors";
import { EncryptionKeyMissingError } from "@/lib/secrets";
import {
	MAX_PROVIDERS,
	NOTIFICATION_SETTINGS_CHANGED,
} from "@/lib/services/notification-settings";
import { ADMIN, createTestContext, EDITOR, type TestContext } from "../helpers";

const KEY = "k".repeat(32);
const NEW_KEY = "n".repeat(32);
const ACCOUNT_SID = `AC${"a".repeat(32)}`;

function withKey(env: Record<string, string> = {}): TestContext {
	return createTestContext({ env: { ENCRYPTION_KEY: KEY, ...env } });
}

describe("NotificationSettingsService", () => {
	it("lists the channels with their environment providers", async () => {
		const t = createTestContext({ env: { WEBHOOK_SECRET: "whsec" } });
		const channels = await t.services.notificationSettings.list(ADMIN);
		expect(channels.map((channel) => channel.id)).toEqual([
			"webhook",
			"email",
			"sms",
		]);
		expect(channels).toMatchObject([
			{
				enabled: true,
				strategy: "active_passive",
				providers: [],
				environmentProviders: [
					{ type: "webhook", name: "Built-in webhook sender" },
				],
				available: true,
			},
			{
				environmentProviders: [
					{ type: "sendgrid", name: "SendGrid (environment variables)" },
				],
				defaultFrom: "status@test.dev",
				available: true,
			},
			{ environmentProviders: [], available: false },
		]);
		const resolved = await t.services.notificationSettings.resolve();
		expect(resolved.webhook.providers).toEqual([
			expect.objectContaining({ secrets: { signingSecret: "whsec" } }),
		]);
		expect(resolved.email.providers).toEqual([
			expect.objectContaining({
				type: "sendgrid",
				from: "status@test.dev",
				secrets: { apiKey: "SG.test" },
			}),
		]);
		await expect(
			t.services.notificationSettings.list(EDITOR),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("uses Amazon SES from the environment, with or without keys", async () => {
		const ses = createTestContext({
			env: {
				EMAIL_PROVIDER: "ses",
				AWS_SES_REGION: "eu-west-1",
				AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
				AWS_SECRET_ACCESS_KEY: "secret",
			},
		});
		const [withKeys] = (await ses.services.notificationSettings.resolve()).email
			.providers;
		expect(withKeys).toMatchObject({
			type: "ses",
			name: "Amazon SES (environment variables)",
			options: { region: "eu-west-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
			secrets: { secretAccessKey: "secret" },
		});
		const role = createTestContext({
			env: { EMAIL_PROVIDER: "ses", AWS_REGION: "us-east-1" },
		});
		const [withRole] = (await role.services.notificationSettings.resolve())
			.email.providers;
		expect(withRole).toMatchObject({
			options: { region: "us-east-1" },
			secrets: {},
		});
		const none = createTestContext({ config: { sendGridApiKey: undefined } });
		const email = (await none.services.notificationSettings.list(ADMIN))[1];
		expect(email).toMatchObject({ environmentProviders: [], available: false });
	});

	it("turns channels on and off and sets the strategy and sender", async () => {
		const t = createTestContext();
		const settings = t.services.notificationSettings;
		const saved = await settings.updateChannel(ADMIN, "email", {
			enabled: false,
			strategy: "load_balanced",
			from: "Acme <status@acme.dev>",
		});
		expect(saved).toMatchObject({
			id: "email",
			enabled: false,
			strategy: "load_balanced",
			from: "Acme <status@acme.dev>",
			revision: 1,
			updatedAt: "2026-11-02T12:00:00.000Z",
			available: false,
		});
		await expect(settings.availability()).resolves.toEqual({
			webhook: true,
			email: false,
			sms: false,
		});
		const kept = await settings.updateChannel(ADMIN, "email", {
			enabled: true,
		});
		expect(kept).toMatchObject({
			enabled: true,
			strategy: "load_balanced",
			from: "Acme <status@acme.dev>",
			revision: 2,
		});
		const cleared = await settings.updateChannel(ADMIN, "email", { from: "" });
		expect(cleared.from).toBeUndefined();
		expect(
			(await settings.updateChannel(ADMIN, "sms", { from: "ACME" })).from,
		).toBe("ACME");
		expect(
			(await settings.updateChannel(ADMIN, "sms", { from: "+15551234567" }))
				.from,
		).toBe("+15551234567");
		expect((await settings.resolve()).email.strategy).toBe("load_balanced");
	});

	it("validates channel updates", async () => {
		const t = createTestContext();
		const settings = t.services.notificationSettings;
		const cases: [
			Parameters<typeof settings.updateChannel>[1],
			object,
			RegExp,
		][] = [
			["email", { from: "not an address" }, /email address/],
			["email", { from: "Name <nope>" }, /email address/],
			["sms", { from: "12" }, /E\.164/],
			["sms", { from: "TOOLONGSENDERID" }, /E\.164/],
			["webhook", { from: "x@y.co" }, /Webhooks have no sender/],
			["email", { strategy: "random" }, /strategy/],
			["fax" as "sms", { enabled: true }, /Invalid option/],
		];
		for (const [channel, input, message] of cases) {
			await expect(
				settings.updateChannel(ADMIN, channel, input),
			).rejects.toThrow(message);
		}
		await expect(
			settings.updateChannel(EDITOR, "email", { enabled: false }),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("adds providers and encrypts their credentials", async () => {
		const t = withKey();
		const settings = t.services.notificationSettings;
		expect(settings.canStoreSecrets).toBe(true);
		const provider = await settings.addProvider(ADMIN, "email", {
			type: "sendgrid",
			name: "SendGrid primary",
			from: "alerts@acme.dev",
			values: { apiKey: "SG.primary" },
		});
		expect(provider).toEqual({
			id: expect.stringMatching(/^prv_/),
			type: "sendgrid",
			name: "SendGrid primary",
			from: "alerts@acme.dev",
			options: {},
			savedSecrets: ["apiKey"],
			credentialsReadable: true,
			createdAt: "2026-11-02T12:00:00.000Z",
			updatedAt: "2026-11-02T12:00:00.000Z",
		});
		const stored = await t.store.get("notification_channels", "email");
		const secret = stored?.providers[0]?.secrets.apiKey ?? "";
		expect(secret).toMatch(/^v1\./);
		expect(JSON.stringify(stored)).not.toContain("SG.primary");

		const resolved = await settings.resolve();
		// Providers of the channel replace the environment provider.
		expect(resolved.email.providers).toEqual([
			{
				id: provider.id,
				type: "sendgrid",
				name: "SendGrid primary",
				from: "alerts@acme.dev",
				options: {},
				secrets: { apiKey: "SG.primary" },
			},
		]);
		expect(resolved.email.version).toBe("2026-11-02T12:00:00.000Z#1");
		const [, email] = await settings.list(ADMIN);
		expect(email?.environmentProviders).toHaveLength(1);
		expect(email?.providers).toEqual([provider]);
	});

	it("needs ENCRYPTION_KEY only for credentials", async () => {
		const t = createTestContext();
		const settings = t.services.notificationSettings;
		expect(settings.canStoreSecrets).toBe(false);
		const error = await settings
			.addProvider(ADMIN, "email", {
				type: "sendgrid",
				name: "SendGrid",
				values: { apiKey: "SG.x" },
			})
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(EncryptionKeyMissingError);
		await expect(
			settings.addProvider(ADMIN, "webhook", {
				type: "webhook",
				name: "Unsigned",
				values: { timeoutSeconds: "5", signingSecret: "" },
			}),
		).resolves.toMatchObject({
			options: { timeoutSeconds: "5" },
			savedSecrets: [],
		});
		await expect(
			settings.addProvider(ADMIN, "email", {
				type: "ses",
				name: "SES with a role",
				values: { region: "us-east-1" },
			}),
		).resolves.toMatchObject({ options: { region: "us-east-1" } });
	});

	it("validates new providers", async () => {
		const t = withKey();
		const settings = t.services.notificationSettings;
		const add = (
			channel: "webhook" | "email" | "sms",
			input: Parameters<typeof settings.addProvider>[2],
		) => settings.addProvider(ADMIN, channel, input);
		await expect(
			add("sms", { type: "sendgrid", name: "x", values: { apiKey: "k" } }),
		).rejects.toThrow(
			"A SendGrid provider cannot send on the Text messaging channel",
		);
		await expect(
			add("email", { type: "sendgrid", name: "x", values: { region: "x" } }),
		).rejects.toThrow('SendGrid has no field named "region"');
		await expect(
			add("email", { type: "sendgrid", name: "x", values: {} }),
		).rejects.toThrow("API key is required");
		await expect(
			add("sms", {
				type: "twilio",
				name: "x",
				values: { accountSid: "SK123", authToken: "t" },
			}),
		).rejects.toThrow("Account SID: the value is not valid");
		await expect(
			add("email", {
				type: "ses",
				name: "x",
				values: { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
			}),
		).rejects.toThrow(
			"Set Access key ID and Secret access key together, or leave them all empty",
		);
		await expect(
			add("sms", {
				type: "twilio",
				name: "x",
				from: "not a number",
				values: { accountSid: ACCOUNT_SID, authToken: "t" },
			}),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			add("email", { type: "smtp" as "ses", name: "x" }),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			settings.addProvider(EDITOR, "email", { type: "ses", name: "x" }),
		).rejects.toBeInstanceOf(ForbiddenError);

		for (let index = 0; index < MAX_PROVIDERS; index++) {
			await add("webhook", { type: "webhook", name: `Hook ${index}` });
		}
		await expect(
			add("webhook", { type: "webhook", name: "One too many" }),
		).rejects.toThrow(`A channel can have at most ${MAX_PROVIDERS} providers`);
	});

	it("edits providers and keeps secrets that are left empty", async () => {
		const t = withKey();
		const settings = t.services.notificationSettings;
		const ses = await settings.addProvider(ADMIN, "email", {
			type: "ses",
			name: "SES",
			from: "ses@acme.dev",
			values: {
				region: "us-east-1",
				accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				secretAccessKey: "first",
			},
		});
		t.clock.advance(1000);
		const renamed = await settings.updateProvider(ADMIN, "email", ses.id, {
			name: "SES backup",
			values: {
				region: "eu-west-1",
				accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				secretAccessKey: "",
			},
		});
		expect(renamed).toMatchObject({
			name: "SES backup",
			from: "ses@acme.dev",
			options: { region: "eu-west-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE" },
			savedSecrets: ["secretAccessKey"],
			updatedAt: "2026-11-02T12:00:01.000Z",
		});
		const secretOf = async () =>
			(await settings.resolve()).email.providers[0]?.secrets.secretAccessKey;
		expect(await secretOf()).toBe("first");

		await settings.updateProvider(ADMIN, "email", ses.id, {
			values: { secretAccessKey: "second" },
			from: null,
		});
		expect(await secretOf()).toBe("second");
		const [, email] = await settings.list(ADMIN);
		// A missing option keeps its value. The provider now uses EMAIL_FROM.
		expect(email?.providers[0]?.from).toBeUndefined();
		expect(email?.providers[0]?.options).toEqual({
			region: "eu-west-1",
			accessKeyId: "AKIAIOSFODNN7EXAMPLE",
		});
		expect((await settings.resolve()).email.providers[0]?.from).toBe(
			"status@test.dev",
		);

		const role = await settings.updateProvider(ADMIN, "email", ses.id, {
			from: "other@acme.dev",
			values: { accessKeyId: "" },
			clear: ["secretAccessKey"],
		});
		expect(role).toMatchObject({
			from: "other@acme.dev",
			options: { region: "eu-west-1" },
			savedSecrets: [],
		});

		await expect(
			settings.updateProvider(ADMIN, "email", ses.id, {
				values: { region: "" },
			}),
		).rejects.toThrow("Region is required");
		await expect(
			settings.updateProvider(ADMIN, "email", ses.id, { clear: ["region"] }),
		).rejects.toThrow('Amazon SES has no secret field named "region"');
		await expect(
			settings.updateProvider(ADMIN, "email", ses.id, { clear: ["nope"] }),
		).rejects.toThrow('Amazon SES has no secret field named "nope"');
		await expect(
			settings.updateProvider(ADMIN, "email", "prv_missing", { name: "x" }),
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it("does not let a required secret be removed", async () => {
		const t = withKey();
		const settings = t.services.notificationSettings;
		const twilio = await settings.addProvider(ADMIN, "sms", {
			type: "twilio",
			name: "Twilio",
			values: { accountSid: ACCOUNT_SID, authToken: "tok" },
		});
		await expect(
			settings.updateProvider(ADMIN, "sms", twilio.id, {
				clear: ["authToken"],
			}),
		).rejects.toThrow("Auth token is required");
	});

	it("orders and removes providers", async () => {
		const t = withKey();
		const settings = t.services.notificationSettings;
		const ids: string[] = [];
		for (const name of ["A", "B", "C"]) {
			ids.push(
				(
					await settings.addProvider(ADMIN, "webhook", {
						type: "webhook",
						name,
					})
				).id,
			);
		}
		const names = async () =>
			(await settings.list(ADMIN))[0]?.providers.map(
				(provider) => provider.name,
			);
		await settings.moveProvider(ADMIN, "webhook", ids[2] as string, "up");
		expect(await names()).toEqual(["A", "C", "B"]);
		await settings.moveProvider(ADMIN, "webhook", ids[0] as string, "down");
		expect(await names()).toEqual(["C", "A", "B"]);
		await settings.moveProvider(ADMIN, "webhook", ids[2] as string, "up");
		expect(await names()).toEqual(["C", "A", "B"]);
		await settings.moveProvider(ADMIN, "webhook", ids[1] as string, "down");
		expect(await names()).toEqual(["C", "A", "B"]);
		await expect(
			settings.moveProvider(ADMIN, "webhook", ids[1] as string, "left" as "up"),
		).rejects.toBeInstanceOf(ValidationError);
		await expect(
			settings.moveProvider(ADMIN, "webhook", "prv_missing", "up"),
		).rejects.toBeInstanceOf(NotFoundError);

		await settings.removeProvider(ADMIN, "webhook", ids[0] as string);
		expect(await names()).toEqual(["C", "B"]);
		await expect(
			settings.removeProvider(ADMIN, "webhook", ids[0] as string),
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			settings.removeProvider(EDITOR, "webhook", ids[1] as string),
		).rejects.toBeInstanceOf(ForbiddenError);
	});

	it("needs a sender before email or text messages can send", async () => {
		const t = withKey();
		const settings = t.services.notificationSettings;
		const twilio = await settings.addProvider(ADMIN, "sms", {
			type: "twilio",
			name: "Twilio",
			values: { accountSid: ACCOUNT_SID, authToken: "tok" },
		});
		expect((await settings.availability()).sms).toBe(false);
		await settings.updateProvider(ADMIN, "sms", twilio.id, {
			from: "+15550001111",
		});
		expect((await settings.availability()).sms).toBe(true);
		await settings.updateProvider(ADMIN, "sms", twilio.id, { from: "" });
		await settings.updateChannel(ADMIN, "sms", { from: "ACME" });
		expect((await settings.availability()).sms).toBe(true);
		expect((await settings.resolve()).sms.providers[0]?.from).toBe("ACME");

		const noSender = createTestContext({ config: { emailFrom: undefined } });
		expect(
			(await noSender.services.notificationSettings.availability()).email,
		).toBe(false);
	});

	it("skips providers whose credentials do not decrypt", async () => {
		const t = withKey();
		await t.services.notificationSettings.addProvider(ADMIN, "email", {
			type: "sendgrid",
			name: "Old key",
			values: { apiKey: "SG.old" },
		});
		const other = createTestContext({
			env: { ENCRYPTION_KEY: NEW_KEY },
			store: t.store,
		});
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const resolved = await other.services.notificationSettings.resolve();
		// The stored providers still replace the environment provider.
		expect(resolved.email.providers).toEqual([]);
		expect(spy).toHaveBeenCalledWith(
			'[notifications] skipped provider "Old key": The value was encrypted with a key that is not configured',
		);
		spy.mockRestore();
		const [, email] = await other.services.notificationSettings.list(ADMIN);
		expect(email?.providers[0]?.credentialsReadable).toBe(false);
	});

	it("encrypts old secrets again with the new key on the next write", async () => {
		const t = withKey();
		await t.services.notificationSettings.addProvider(ADMIN, "email", {
			type: "sendgrid",
			name: "SendGrid",
			values: { apiKey: "SG.rotate" },
		});
		const before = (await t.store.get("notification_channels", "email"))
			?.providers[0]?.secrets.apiKey;
		const rotated = createTestContext({
			env: { ENCRYPTION_KEY: NEW_KEY, ENCRYPTION_KEY_PREVIOUS: KEY },
			store: t.store,
		});
		const settings = rotated.services.notificationSettings;
		expect((await settings.resolve()).email.providers[0]?.secrets).toEqual({
			apiKey: "SG.rotate",
		});
		await settings.updateChannel(ADMIN, "email", { strategy: "load_balanced" });
		const after = (await t.store.get("notification_channels", "email"))
			?.providers[0]?.secrets.apiKey;
		expect(after).not.toBe(before);
		expect(after?.split(".")[1]).not.toBe(before?.split(".")[1]);
		const newOnly = createTestContext({
			env: { ENCRYPTION_KEY: NEW_KEY },
			store: t.store,
		});
		expect(
			(await newOnly.services.notificationSettings.resolve()).email.providers[0]
				?.secrets,
		).toEqual({ apiKey: "SG.rotate" });
	});

	it("refuses to overwrite a change that somebody else saved meanwhile", async () => {
		const t = createTestContext();
		const settings = t.services.notificationSettings;
		await settings.updateChannel(ADMIN, "sms", { enabled: true });
		const stale = await t.store.get("notification_channels", "sms");
		await settings.updateChannel(ADMIN, "sms", { enabled: false });
		vi.spyOn(t.store, "get").mockResolvedValueOnce(stale);
		const error = await settings
			.updateChannel(ADMIN, "sms", { strategy: "load_balanced" })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ConflictError);
		expect((error as Error).message).toBe(NOTIFICATION_SETTINGS_CHANGED);
		expect((await settings.list(ADMIN))[2]).toMatchObject({
			enabled: false,
			strategy: "active_passive",
		});
	});
});
