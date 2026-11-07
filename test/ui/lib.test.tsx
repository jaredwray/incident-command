import {
	flash,
	getMemberContext,
	requireMember,
	SESSION_COOKIE,
	secureCookies,
	startSession,
} from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import {
	flashCodeForError,
	flashEntry,
	readFlash,
	resolveFlash,
	roleFlashCode,
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
	it("builds flash urls from catalog codes", () => {
		expect(flash("/manage", "settings_saved")).toBe(
			"/manage?notice=settings_saved",
		);
		expectFlashRedirect(
			flash("/manage", "settings_saved"),
			"/manage",
			"notice",
			"Settings saved",
		);
		expect(
			flash("/manage/incidents/new?kind=incident", "validation_failed"),
		).toBe("/manage/incidents/new?kind=incident&error=validation_failed");
		expect(
			flashMessage(
				flash("/manage/incidents/new?kind=incident", "validation_failed"),
				"error",
			),
		).toBe("Check the form and try again.");
	});

	it("rejects unknown flash query values", () => {
		expect(readFlash("notice", "Member removed you suck")).toBeUndefined();
		expect(readFlash("notice", undefined)).toBeUndefined();
		expect(readFlash("notice", "")).toBeUndefined();
		expect(readFlash("error", "member_removed")).toBeUndefined();
		expect(resolveFlash({ notice: "Member removed you suck" })).toEqual({});
		expect(resolveFlash({ notice: "member_removed" })).toEqual({
			notice: "Member removed",
		});
		expect(resolveFlash({ error: "invalid_credentials" })).toEqual({
			error: "Invalid email or password",
		});
		expect(flashEntry("member_removed")?.id).toMatch(/^fls_/);
		expect(flashEntry("nope")).toBeUndefined();
		expect(roleFlashCode("admin")).toBe("role_required_admin");
		expect(flashCodeForError(new ValidationError("title: Too small"))).toBe(
			"validation_failed",
		);
		expect(
			flashCodeForError(new ValidationError("Current password is incorrect")),
		).toBe("current_password_incorrect");
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
			"Check the form and try again.",
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
