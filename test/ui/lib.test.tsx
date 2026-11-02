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
import { form, redirectOf, setupApp, signIn } from "./app";
import { cookieJar, setRequestHeaders } from "./next-state";

describe("auth helpers", () => {
	it("builds flash urls", () => {
		expect(flash("/manage", "notice", "Saved!")).toBe("/manage?notice=Saved!");
		expect(flash("/manage/incidents/new?kind=incident", "error", "a & b")).toBe(
			"/manage/incidents/new?kind=incident&error=a%20%26%20b",
		);
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
		expect(await redirectOf(requireMember("admin"))).toBe(
			"/manage?error=That page requires the admin role",
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
		expect(
			await redirectOf(
				attempt("/x", async () => {
					throw new ValidationError("nope");
				}),
			),
		).toBe("/x?error=nope");
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
