import {
	flash,
	getMemberContext,
	requireMember,
	SESSION_COOKIE,
	secureCookies,
	startSession,
} from "@/lib/auth";
import { hmacSha256 } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";
import {
	flashSigningKey,
	readFlash,
	resolveFlash,
	sealFlash,
} from "@/lib/flash";
import {
	attempt,
	checkbox,
	dateTime,
	integer,
	list,
	nonEmpty,
	optionalText,
	text,
} from "@/lib/manage/forms";
import { publicOrigin } from "@/lib/manage/origin";
import {
	expectFlashRedirect,
	flashMessage,
	form,
	redirectOf,
	setupApp,
	signIn,
} from "./app";
import { cookieJar, setRequestHeaders } from "./next-state";

describe("auth helpers", () => {
	it("builds and verifies signed flash urls", () => {
		const url = flash("/manage", "notice", "Saved!");
		expectFlashRedirect(url, "/manage", "notice", "Saved!");
		expect(
			flash("/manage/incidents/new?kind=incident", "error", "a & b"),
		).toMatch(/^\/manage\/incidents\/new\?kind=incident&error=/);
		expect(
			flashMessage(
				flash("/manage/incidents/new?kind=incident", "error", "a & b"),
				"error",
			),
		).toBe("a & b");
	});

	it("rejects forged or plain flash query values", () => {
		expect(readFlash("notice", "Member removed you suck")).toBeUndefined();
		expect(readFlash("notice", undefined)).toBeUndefined();
		expect(readFlash("notice", "")).toBeUndefined();
		expect(readFlash("error", "nope.notasignature")).toBeUndefined();
		expect(readFlash("notice", ".abcdef")).toBeUndefined();
		expect(readFlash("notice", "payload.")).toBeUndefined();
		const sealed = sealFlash("notice", "Member removed");
		expect(readFlash("error", sealed)).toBeUndefined();
		expect(readFlash("notice", `${sealed}x`)).toBeUndefined();
		expect(resolveFlash({ notice: "Member removed you suck" })).toEqual({});
		expect(resolveFlash({ notice: sealed })).toEqual({
			notice: "Member removed",
		});
		expect(resolveFlash({ error: sealFlash("error", "Nope") })).toEqual({
			error: "Nope",
		});
		const long = "x".repeat(501);
		const payload = Buffer.from(long, "utf8").toString("base64url");
		const key = flashSigningKey();
		expect(key).toBeDefined();
		const sig = hmacSha256(key as string, `notice.${payload}`);
		expect(readFlash("notice", `${payload}.${sig}`)).toBeUndefined();
		expect(readFlash("notice", sealFlash("notice", long))).toBe(
			"x".repeat(500),
		);
		expect(sealFlash("notice", "")).toMatch(/^\./);
		expect(readFlash("notice", sealFlash("notice", ""))).toBeUndefined();
	});

	it("picks a flash signing key from the environment", () => {
		expect(flashSigningKey({})).toBe("incident-command-dev-flash");
		expect(flashSigningKey({ NODE_ENV: "test" })).toBe(
			"incident-command-dev-flash",
		);
		expect(flashSigningKey({ FLASH_SECRET: " flash " })).toBe("flash");
		expect(flashSigningKey({ SETUP_TOKEN: "setup" })).toBe("setup");
		expect(flashSigningKey({ WEBHOOK_SECRET: "hook", NODE_ENV: "test" })).toBe(
			"incident-command-dev-flash",
		);
		expect(
			flashSigningKey({
				FLASH_SECRET: "a",
				SETUP_TOKEN: "b",
			}),
		).toBe("a");
		expect(flashSigningKey({ NODE_ENV: "production" })).toBeUndefined();
		expect(flash("/manage", "notice", "x")).toMatch(/\?notice=/);
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("FLASH_SECRET", "");
		vi.stubEnv("SETUP_TOKEN", "");
		expect(flashSigningKey()).toBeUndefined();
		expect(sealFlash("notice", "Saved")).toBeUndefined();
		expect(readFlash("notice", "a.b")).toBeUndefined();
		expect(flash("/manage", "notice", "Saved")).toBe("/manage");
		vi.unstubAllEnvs();
	});

	it("decides when cookies are secure", () => {
		expect(secureCookies("https://status.acme.dev")).toBe(true);
		expect(secureCookies("http://localhost:3000")).toBe(false);
		vi.stubEnv("NODE_ENV", "production");
		expect(secureCookies(undefined)).toBe(true);
		vi.stubEnv("NODE_ENV", "test");
		expect(secureCookies(undefined)).toBe(false);
		vi.unstubAllEnvs();
	});

	it("resolves the member from the session cookie", async () => {
		const { app } = await setupApp({ SITE_URL: "https://status.acme.dev" });
		await expect(getMemberContext()).resolves.toBeUndefined();
		const { member } = await signIn(app, "editor");
		const context = await getMemberContext();
		expect(context?.member.id).toBe(member.id);
		expect(context?.actor).toEqual({
			type: "member",
			id: member.id,
			name: member.name,
			role: "editor",
		});
		await expect(requireMember("editor")).resolves.toBeDefined();
		expectFlashRedirect(
			await redirectOf(requireMember("admin")),
			"/manage",
			"error",
			"That page requires the admin role",
		);

		await startSession(app, member.id);
		expect(cookieJar.get(SESSION_COOKIE)).toMatchObject({ secure: true });
	});
});

describe("form helpers", () => {
	const data = form({
		name: "Ada",
		empty: "",
		hidden: "on",
		ids: ["a", "", "b"],
		order: " 3 ",
		when: "2026-11-02T10:30",
	});

	it("reads typed values", () => {
		data.append("file", new Blob(["x"]));
		expect(text(data, "name")).toBe("Ada");
		expect(text(data, "missing")).toBe("");
		expect(text(data, "file")).toBe("");
		expect(optionalText(data, "empty")).toBe("");
		expect(optionalText(data, "missing")).toBeUndefined();
		expect(nonEmpty(data, "empty")).toBeUndefined();
		expect(nonEmpty(data, "name")).toBe("Ada");
		expect(checkbox(data, "hidden")).toBe(true);
		expect(checkbox(data, "missing")).toBe(false);
		expect(list(data, "ids")).toEqual(["a", "b"]);
		expect(integer(data, "order")).toBe(3);
		expect(integer(data, "missing")).toBeUndefined();
		expect(dateTime(data, "when")).toBe("2026-11-02T10:30:00.000Z");
		expect(dateTime(data, "missing")).toBeUndefined();
	});

	it("redirects on app errors and rethrows others", async () => {
		await expect(attempt("/x", async () => 42)).resolves.toBe(42);
		expectFlashRedirect(
			await redirectOf(
				attempt("/x", async () => {
					throw new ValidationError("nope");
				}),
			),
			"/x",
			"error",
			"nope",
		);
		await expect(
			attempt("/x", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});
});

describe("publicOrigin", () => {
	it("prefers the configured url, then forwarded and host headers", async () => {
		await expect(publicOrigin("https://status.acme.dev/")).resolves.toBe(
			"https://status.acme.dev",
		);
		setRequestHeaders({
			"x-forwarded-host": "status.acme.dev",
			"x-forwarded-proto": "https",
			host: "internal:3000",
		});
		await expect(publicOrigin(undefined)).resolves.toBe(
			"https://status.acme.dev",
		);
		setRequestHeaders({ host: "localhost:3000" });
		await expect(publicOrigin(undefined)).resolves.toBe(
			"http://localhost:3000",
		);
		setRequestHeaders({ host: "status.example.com" });
		await expect(publicOrigin(undefined)).resolves.toBe(
			"https://status.example.com",
		);
		setRequestHeaders({});
		await expect(publicOrigin(undefined)).resolves.toBe(
			"http://localhost:3000",
		);
	});
});
