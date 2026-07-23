import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function parseMasterKey(raw: string): Buffer {
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		return Buffer.from(raw, "hex");
	}
	const key = Buffer.from(raw, "base64");
	if (key.length !== 32) {
		throw new Error("MASTER_KEY must decode to exactly 32 bytes");
	}
	return key;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Output format: base64(iv || authTag || ciphertext)
 */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, masterKey, iv, {
		authTagLength: AUTH_TAG_LENGTH,
	});
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string, masterKey: Buffer): string {
	const buf = Buffer.from(payload, "base64");
	if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
		throw new Error("Invalid encrypted secret payload");
	}
	const iv = buf.subarray(0, IV_LENGTH);
	const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
	const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
	const decipher = createDecipheriv(ALGORITHM, masterKey, iv, {
		authTagLength: AUTH_TAG_LENGTH,
	});
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function generateTrackingId(): string {
	return randomBytes(16).toString("hex");
}

export function generateWebhookSecret(): string {
	return randomBytes(32).toString("hex");
}
