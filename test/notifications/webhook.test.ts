import { AirhornSendType } from "airhorn";
import { hmacSha256 } from "@/lib/crypto";
import { SIGNATURE_HEADER, WebhookProvider } from "@/lib/notifications/webhook";

const message = {
	to: "https://hooks.example.com/x",
	from: "",
	content: JSON.stringify({ text: "hello" }),
	type: AirhornSendType.Webhook,
};

describe("WebhookProvider", () => {
	it("advertises webhook capability", () => {
		const provider = new WebhookProvider();
		expect(provider.name).toBe("incident-command-webhook");
		expect(provider.capabilities).toEqual([AirhornSendType.Webhook]);
	});

	it("posts the content as the raw JSON body with a signature", async () => {
		const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
		const provider = new WebhookProvider({
			secret: "s3cret",
			fetch,
			timeoutMs: 500,
		});
		const result = await provider.send(message);
		expect(result).toEqual({
			success: true,
			response: { status: 200 },
			errors: [],
		});
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(message.to);
		expect(init.method).toBe("POST");
		expect(init.body).toBe(message.content);
		const headers = init.headers as Record<string, string>;
		expect(headers["content-type"]).toBe("application/json");
		expect(headers[SIGNATURE_HEADER]).toBe(
			`sha256=${hmacSha256("s3cret", message.content)}`,
		);
	});

	it("omits the signature without a secret and reports http failures", async () => {
		const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
		const provider = new WebhookProvider({ fetch });
		const result = await provider.send(message);
		expect(result.success).toBe(false);
		expect(result.errors[0]?.message).toBe("Webhook responded with status 500");
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(
			(init.headers as Record<string, string>)[SIGNATURE_HEADER],
		).toBeUndefined();
	});

	it("reports network errors", async () => {
		const provider = new WebhookProvider({
			fetch: vi.fn(async () => {
				throw new Error("ECONNREFUSED");
			}),
		});
		const result = await provider.send(message);
		expect(result).toMatchObject({
			success: false,
			response: { error: "ECONNREFUSED" },
		});
	});

	it("wraps non-Error failures", async () => {
		const provider = new WebhookProvider({
			fetch: vi.fn(async () => {
				throw "boom";
			}),
		});
		const result = await provider.send(message);
		expect(result.errors[0]?.message).toBe("boom");
	});

	it("uses the global fetch by default", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 204 }));
		const result = await new WebhookProvider().send(message);
		expect(result.success).toBe(true);
		spy.mockRestore();
	});
});
