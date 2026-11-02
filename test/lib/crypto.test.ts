import {
	createId,
	createSecret,
	hashPassword,
	hmacSha256,
	safeEqual,
	sha256,
	verifyPassword,
} from "@/lib/crypto";

describe("crypto", () => {
	it("creates prefixed ids of the requested length", () => {
		const id = createId("inc");
		expect(id).toMatch(/^inc_[0-9a-z]{16}$/);
		expect(createId("x", 4)).toMatch(/^x_[0-9a-z]{4}$/);
		expect(createId("inc")).not.toBe(id);
	});

	it("creates url-safe secrets", () => {
		expect(createSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(createSecret(8)).toHaveLength(11);
	});

	it("hashes deterministically", () => {
		expect(sha256("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
		expect(hmacSha256("key", "body")).toMatch(/^[0-9a-f]{64}$/);
		expect(hmacSha256("key", "body")).not.toBe(hmacSha256("other", "body"));
	});

	it("compares strings in constant time", () => {
		expect(safeEqual("abc", "abc")).toBe(true);
		expect(safeEqual("abc", "abd")).toBe(false);
		expect(safeEqual("abc", "abcd")).toBe(false);
	});

	it("hashes and verifies passwords", async () => {
		const hash = await hashPassword("correct horse");
		expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
		await expect(verifyPassword("correct horse", hash)).resolves.toBe(true);
		await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
		expect(await hashPassword("correct horse")).not.toBe(hash);
	});

	it("rejects malformed password hashes", async () => {
		await expect(verifyPassword("x", "bcrypt$abc")).resolves.toBe(false);
		await expect(verifyPassword("x", "scrypt$1$2$3")).resolves.toBe(false);
	});

	it("propagates scrypt errors", async () => {
		await expect(
			verifyPassword("x", "scrypt$3$8$1$c2FsdA$aGFzaA"),
		).rejects.toThrow();
	});
});
