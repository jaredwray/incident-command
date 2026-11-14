import {
	ENCRYPTION_KEY_MISSING,
	EncryptionKeyMissingError,
	SecretBox,
} from "@/lib/secrets";

const KEY = "k".repeat(32);
const OLD = "o".repeat(32);

describe("SecretBox", () => {
	it("encrypts with a random IV and decrypts with the same context", () => {
		const box = new SecretBox({ key: KEY, previousKeys: [] });
		const first = box.encrypt("SG.secret", "ctx/a");
		const second = box.encrypt("SG.secret", "ctx/a");
		expect(first).not.toBe(second);
		expect(first).toMatch(/^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]+$/);
		expect(first).not.toContain("SG.secret");
		expect(box.decrypt(first, "ctx/a")).toBe("SG.secret");
		expect(box.canEncrypt).toBe(true);
	});

	it("rejects a value moved to a different context or changed", () => {
		const box = new SecretBox({ key: KEY, previousKeys: [] });
		const value = box.encrypt("secret", "notification/email/prv_1/apiKey");
		expect(() =>
			box.decrypt(value, "notification/email/prv_2/apiKey"),
		).toThrow();
		const parts = value.split(".");
		const body = Buffer.from(parts[3] as string, "base64url");
		body[0] = (body[0] as number) ^ 1;
		parts[3] = body.toString("base64url");
		expect(() =>
			box.decrypt(parts.join("."), "notification/email/prv_1/apiKey"),
		).toThrow();
	});

	it("rejects values that are not encrypted secrets", () => {
		const box = new SecretBox({ key: KEY, previousKeys: [] });
		for (const value of [
			"plain",
			"v2.a.b.c",
			"v1.a.b",
			"v1.a.b.c.d",
			"v1.a..c",
		]) {
			expect(() => box.decrypt(value, "ctx")).toThrow(
				"The value is not an encrypted secret",
			);
		}
		const id = box.encrypt("x", "ctx").split(".")[1];
		expect(() => box.decrypt(`v1.${id}.AAAA.AAAA`, "ctx")).toThrow();
	});

	it("decrypts with previous keys and rotates to the current key", () => {
		const old = new SecretBox({ key: OLD, previousKeys: [] });
		const stored = old.encrypt("token", "ctx");
		const unknown = new SecretBox({ key: KEY, previousKeys: [] });
		expect(() => unknown.decrypt(stored, "ctx")).toThrow(
			"The value was encrypted with a key that is not configured",
		);
		const box = new SecretBox({ key: KEY, previousKeys: [OLD] });
		expect(box.decrypt(stored, "ctx")).toBe("token");
		const rotated = box.rotate(stored, "ctx");
		expect(rotated).not.toBe(stored);
		expect(rotated.split(".")[1]).toBe(box.encrypt("x", "ctx").split(".")[1]);
		expect(unknown.decrypt(rotated, "ctx")).toBe("token");
		// Current values, unknown keys and missing current keys stay as they are.
		expect(box.rotate(rotated, "ctx")).toBe(rotated);
		expect(unknown.rotate(stored, "ctx")).toBe(stored);
		const readOnly = new SecretBox({ previousKeys: [OLD] });
		expect(readOnly.rotate(stored, "ctx")).toBe(stored);
		expect(readOnly.decrypt(stored, "ctx")).toBe("token");
	});

	it("cannot encrypt without a key", () => {
		const box = new SecretBox({ previousKeys: [] });
		expect(box.canEncrypt).toBe(false);
		expect(() => box.encrypt("x", "ctx")).toThrow(EncryptionKeyMissingError);
		expect(() => box.encrypt("x", "ctx")).toThrow(ENCRYPTION_KEY_MISSING);
	});
});
