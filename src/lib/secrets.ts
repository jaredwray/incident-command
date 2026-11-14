import {
	createCipheriv,
	createDecipheriv,
	createHash,
	hkdfSync,
	randomBytes,
} from "node:crypto";
import { AppError } from "./errors";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The message of the error when no encryption key is set. */
export const ENCRYPTION_KEY_MISSING =
	"Set ENCRYPTION_KEY on the server before you save provider credentials.";

/** Thrown when a write needs encryption and no encryption key is set. */
export class EncryptionKeyMissingError extends AppError {
	constructor() {
		super("unavailable", ENCRYPTION_KEY_MISSING);
		this.name = "EncryptionKeyMissingError";
	}
}

export interface EncryptionKeys {
	/** The key that encrypts new values (`ENCRYPTION_KEY`). */
	key?: string;
	/** Old keys that can still decrypt values (`ENCRYPTION_KEY_PREVIOUS`). */
	previousKeys: readonly string[];
}

interface DerivedKey {
	id: string;
	material: Buffer;
}

/**
 * Derives a 256-bit AES key from a secret string with HKDF-SHA256. The key id
 * is a short hash of the derived key. It tells which key encrypted a value.
 */
function derive(secret: string): DerivedKey {
	const material = Buffer.from(
		hkdfSync("sha256", secret, "incident-command", "stored-secrets", 32),
	);
	const id = createHash("sha256").update(material).digest("hex").slice(0, 8);
	return { id, material };
}

/**
 * Encrypts small secrets, such as provider API keys, before they go to the
 * store. Each value uses AES-256-GCM with a random IV. The `context` is
 * authenticated data: a value only decrypts with the context that encrypted
 * it, so a stored value cannot move to a different field or provider.
 *
 * Format: `v1.<key id>.<iv>.<ciphertext and tag>` (base64url parts).
 */
export class SecretBox {
	private readonly current?: DerivedKey;
	private readonly keys: DerivedKey[];

	constructor(keys: EncryptionKeys) {
		this.current = keys.key === undefined ? undefined : derive(keys.key);
		this.keys = [
			...(this.current ? [this.current] : []),
			...keys.previousKeys.map(derive),
		];
	}

	/** True when new values can be encrypted. */
	get canEncrypt(): boolean {
		return this.current !== undefined;
	}

	encrypt(plaintext: string, context: string): string {
		const key = this.current;
		if (!key) {
			throw new EncryptionKeyMissingError();
		}
		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv(ALGORITHM, key.material, iv);
		cipher.setAAD(Buffer.from(context, "utf8"));
		const body = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
			cipher.getAuthTag(),
		]);
		return [
			VERSION,
			key.id,
			iv.toString("base64url"),
			body.toString("base64url"),
		].join(".");
	}

	/** Decrypts a value. Throws when the value is damaged, moved, or from an unknown key. */
	decrypt(value: string, context: string): string {
		const [version, id, iv, body, ...rest] = value.split(".");
		if (version !== VERSION || !iv || !body || rest.length > 0) {
			throw new Error("The value is not an encrypted secret");
		}
		const key = this.keys.find((candidate) => candidate.id === id);
		if (!key) {
			throw new Error(
				"The value was encrypted with a key that is not configured",
			);
		}
		const data = Buffer.from(body, "base64url");
		const decipher = createDecipheriv(
			ALGORITHM,
			key.material,
			Buffer.from(iv, "base64url"),
			{ authTagLength: TAG_BYTES },
		);
		decipher.setAAD(Buffer.from(context, "utf8"));
		decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
		return Buffer.concat([
			decipher.update(data.subarray(0, data.length - TAG_BYTES)),
			decipher.final(),
		]).toString("utf8");
	}

	/**
	 * Encrypts the value again with the current key when an old key encrypted
	 * it. Returns the value unchanged when no change is necessary or possible.
	 */
	rotate(value: string, context: string): string {
		const current = this.current;
		if (!current || value.split(".")[1] === current.id) {
			return value;
		}
		try {
			return this.encrypt(this.decrypt(value, context), context);
		} catch {
			return value;
		}
	}
}
