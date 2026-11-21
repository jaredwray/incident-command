import { maskTarget } from "@/lib/notifications/mask";

describe("maskTarget", () => {
	it("hides an email, a phone number and a webhook host", () => {
		expect(maskTarget("email", "jane@example.com")).toBe("j***@example.com");
		expect(maskTarget("email", "not-an-email")).toBe("***");
		expect(maskTarget("sms", "+1 (555) 123-4567")).toBe("***4567");
		expect(maskTarget("sms", "call me")).toBe("***");
		expect(maskTarget("webhook", "https://hooks.example.com/a")).toBe(
			"hooks.example.com",
		);
		expect(maskTarget("webhook", "not a url")).toBe("***");
		expect(maskTarget("webhook", "file:///tmp/hook")).toBe("***");
	});
});
