import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed-cookie sessions. The payload is readable by the browser but not
 * forgeable, which is all the dashboard needs: it carries an identity, never a
 * capability, and every request re-checks guild access against Discord's own answer
 * stored at sign-in time.
 */
export interface DashboardSession {
	userId: string;
	username: string;
	avatarUrl: string | null;
	/** Guild ids where Discord reported MANAGE_GUILD at sign-in. */
	guildIds: string[];
	guilds: { id: string; name: string }[];
	csrfToken: string;
	expiresAt: number;
}

export const SESSION_COOKIE = "githubot_session";
export const OAUTH_STATE_COOKIE = "githubot_oauth_state";

/**
 * Over https the `__Host-` prefix is used, which browsers only honour on a cookie
 * that is Secure, Path=/ and carries no Domain — so a compromised sibling subdomain
 * cannot overwrite the session. The prefix is invalid without Secure, so plain-http
 * deployments keep the bare name.
 */
export function cookieName(base: string, secure: boolean): string {
	return secure ? `__Host-${base}` : base;
}

/**
 * Derived so the cookie key is not the same bytes that decrypt webhook secrets;
 * a signing oracle then cannot be turned into a decryption oracle.
 */
function signingKey(masterKey: Buffer): Buffer {
	return createHmac("sha256", masterKey).update("githubot:dashboard:session:v1").digest();
}

function sign(payload: string, masterKey: Buffer): string {
	return createHmac("sha256", signingKey(masterKey)).update(payload).digest("base64url");
}

export function createCsrfToken(): string {
	return randomBytes(18).toString("base64url");
}

export function encodeSession(session: DashboardSession, masterKey: Buffer): string {
	const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
	return `${payload}.${sign(payload, masterKey)}`;
}

/**
 * Browsers drop a cookie whose name, value and attributes exceed 4096 bytes —
 * silently, so sign-in just loops. This leaves room for the name and attributes.
 */
const SESSION_VALUE_BUDGET = 3_600;
const GUILD_NAME_MAX = 64;

/**
 * Keeps the encoded session under the cookie budget: long server names are
 * shortened, then servers are dropped from the end until it fits. Without this,
 * someone managing a few dozen servers could never stay signed in.
 */
export function fitCookieBudget(session: DashboardSession, masterKey: Buffer): DashboardSession {
	const guilds = session.guilds.map((guild) => ({
		id: guild.id,
		// Array.from splits by code point, so an emoji is never cut in half.
		name: Array.from(guild.name).slice(0, GUILD_NAME_MAX).join(""),
	}));
	let fitted: DashboardSession = { ...session, guilds, guildIds: guilds.map((g) => g.id) };
	while (
		fitted.guilds.length > 0 &&
		encodeSession(fitted, masterKey).length > SESSION_VALUE_BUDGET
	) {
		const kept = fitted.guilds.slice(0, -1);
		fitted = { ...fitted, guilds: kept, guildIds: kept.map((g) => g.id) };
	}
	return fitted;
}

export function decodeSession(raw: string | undefined, masterKey: Buffer): DashboardSession | null {
	if (!raw) return null;
	const dot = raw.lastIndexOf(".");
	if (dot <= 0) return null;

	const payload = raw.slice(0, dot);
	const presented = Buffer.from(raw.slice(dot + 1));
	const expected = Buffer.from(sign(payload, masterKey));
	if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (!isSession(parsed)) return null;
		return parsed.expiresAt > Date.now() ? parsed : null;
	} catch {
		return null;
	}
}

function isSession(value: unknown): value is DashboardSession {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.userId === "string" &&
		typeof candidate.username === "string" &&
		typeof candidate.csrfToken === "string" &&
		typeof candidate.expiresAt === "number" &&
		Array.isArray(candidate.guildIds) &&
		Array.isArray(candidate.guilds)
	);
}

export interface CookieOptions {
	maxAgeSeconds?: number;
	secure: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
	const parts = [
		`${name}=${value}`,
		"Path=/",
		"HttpOnly",
		// Lax still sends the cookie on the OAuth redirect back from Discord,
		// while blocking it on cross-site POSTs.
		"SameSite=Lax",
	];
	if (options.secure) parts.push("Secure");
	parts.push(`Max-Age=${options.maxAgeSeconds ?? 0}`);
	return parts.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
	return serializeCookie(name, "", { maxAgeSeconds: 0, secure });
}

export function readCookie(header: string | undefined, name: string): string | undefined {
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return undefined;
}

/** Constant-time so a submitted token cannot be recovered by timing the comparison. */
export function csrfMatches(expected: string, presented: string | undefined): boolean {
	if (!presented) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(presented);
	return a.length === b.length && timingSafeEqual(a, b);
}
