import { AirhornSendType } from "airhorn";
import { SENDGRID_URL, SendGridProvider } from "@/lib/notifications/sendgrid";

const message = {
	to: "jane@example.com",
	from: "status@acme.dev",
	subject: "",
	content: "<p>Hello</p>",
	type: AirhornSendType.Email,
};

function request(fetch: ReturnType<typeof vi.fn>) {
	const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
	return { url, init, body: JSON.parse(String(init.body)) };
}

describe("SendGridProvider", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("posts the mail with its own key and returns the message id", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(null, {
					status: 202,
					headers: { "x-message-id": "msg_1" },
				}),
		);
		const provider = new SendGridProvider({ apiKey: "SG.one", fetch });
		const result = await provider.send(message);
		expect(result).toEqual({
			success: true,
			response: { status: 202, messageId: "msg_1" },
			errors: [],
		});
		const { url, init, body } = request(fetch);
		expect(url).toBe(SENDGRID_URL);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).authorization).toBe(
			"Bearer SG.one",
		);
		expect(body).toEqual({
			personalizations: [{ to: [{ email: "jane@example.com" }] }],
			from: { email: "status@acme.dev" },
			subject: "Notification",
			content: [
				{ type: "text/plain", value: "<p>Hello</p>" },
				{ type: "text/html", value: "<p>Hello</p>" },
			],
		});
	});

	it("uses the global fetch, a named sender and the plain text option", async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 202 }));
		vi.stubGlobal("fetch", fetch);
		const provider = new SendGridProvider({ apiKey: "SG.two" });
		const result = await provider.send(
			{ ...message, from: "Acme Status <status@acme.dev>", subject: "Hi" },
			{ text: "Hello" },
		);
		expect(result.response).toEqual({ status: 202, messageId: undefined });
		const { body } = request(fetch);
		expect(body.from).toEqual({
			name: "Acme Status",
			email: "status@acme.dev",
		});
		expect(body.subject).toBe("Hi");
		expect(body.content[0]).toEqual({ type: "text/plain", value: "Hello" });
	});

	it("needs a sender", async () => {
		const fetch = vi.fn();
		const result = await new SendGridProvider({ apiKey: "k", fetch }).send({
			...message,
			from: "",
		});
		expect(result.success).toBe(false);
		expect(result.errors[0]?.message).toBe("SendGrid needs a from address");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("reports http failures with a short body", async () => {
		const fetch = vi.fn(
			async () => new Response("x".repeat(900), { status: 400 }),
		);
		const result = await new SendGridProvider({ apiKey: "k", fetch }).send(
			message,
		);
		expect(result.success).toBe(false);
		expect(result.errors[0]?.message).toBe(
			"SendGrid responded with status 400",
		);
		expect(result.response).toEqual({ status: 400, body: "x".repeat(500) });
	});

	it("reports network errors", async () => {
		const failing = (error: unknown) =>
			new SendGridProvider({
				apiKey: "k",
				fetch: vi.fn(async () => {
					throw error;
				}),
			}).send(message);
		const thrown = await failing(new Error("ECONNRESET"));
		expect(thrown).toEqual({
			success: false,
			response: { error: "ECONNRESET" },
			errors: [new Error("ECONNRESET")],
		});
		const odd = await failing("odd");
		expect(odd.errors[0]?.message).toBe("odd");
	});
});
