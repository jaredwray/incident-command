import {
	createHash,
	createHmac,
	randomBytes,
	type ScryptOptions,
	scrypt,
	timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Generates a short, URL-safe, prefixed identifier such as `inc_8f3k2j1m0q9w7e5r`. */
export function createId(prefix: string, length = 16): string {
	const bytes = randomBytes(length);
	let id = "";
	for (const byte of bytes) {
		id += ID_ALPHABET[byte % ID_ALPHABET.length];
	}
	return `${prefix}_${id}`;
}

/** Generates a high-entropy secret token (base64url). */
export function createSecret(bytes = 32): string {
	return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(secret: string, value: string): string {
	return createHmac("sha256", secret).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: ScryptOptions,
) => Promise<Buffer>;

function deriveKey(
	password: string,
	salt: Buffer,
	n: number,
	r: number,
	p: number,
): Promise<Buffer> {
	return scryptAsync(password, salt, KEY_LENGTH, {
		N: n,
		r,
		p,
		maxmem: 128 * n * r * 2,
	});
}

/** Hashes a password with scrypt. Format: `scrypt$N$r$p$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
	return [
		"scrypt",
		SCRYPT_N,
		SCRYPT_R,
		SCRYPT_P,
		salt.toString("base64url"),
		key.toString("base64url"),
	].join("$");
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const [scheme, n, r, p, salt, hash] = stored.split("$");
	if (scheme !== "scrypt" || !salt || !hash) {
		return false;
	}
	const key = await deriveKey(
		password,
		Buffer.from(salt, "base64url"),
		Number(n),
		Number(r),
		Number(p),
	);
	return safeEqual(key.toString("base64url"), hash);
}
