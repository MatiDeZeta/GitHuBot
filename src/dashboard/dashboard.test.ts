import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "../config/env.js";
import { DEFAULT_ENABLED_EVENTS } from "../config/events.js";
import { createLogger } from "../config/logger.js";
import { encryptSecret, parseMasterKey } from "../crypto/secrets.js";
import { createDb, type DbHandle, migrate } from "../db/index.js";
import { createServer } from "../server/app.js";
import {
	cookieName,
	createCsrfToken,
	type DashboardSession,
	decodeSession,
	encodeSession,
	fitCookieBudget,
	readCookie,
	SESSION_COOKIE,
} from "./session.js";

// DASHBOARD_BASE_URL is https in these tests, so the cookie carries the __Host- prefix.
const COOKIE = cookieName(SESSION_COOKIE, true);

const GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";

const DASHBOARD_ENV = {
	NODE_ENV: "test",
	DASHBOARD_ENABLED: "true",
	DASHBOARD_BASE_URL: "https://bot.example.com",
	DISCORD_CLIENT_ID: "333333333333333333",
	DISCORD_CLIENT_SECRET: "a-client-secret",
} as NodeJS.ProcessEnv;

describe("dashboard session", () => {
	const key = parseMasterKey(randomBytes(32).toString("hex"));

	function session(overrides: Partial<DashboardSession> = {}): DashboardSession {
		return {
			userId: "1",
			username: "ada",
			avatarUrl: null,
			guildIds: [GUILD],
			guilds: [{ id: GUILD, name: "Acme" }],
			csrfToken: createCsrfToken(),
			expiresAt: Date.now() + 60_000,
			...overrides,
		};
	}

	it("round-trips a signed session", () => {
		const original = session();
		const decoded = decodeSession(encodeSession(original, key), key);
		expect(decoded).toEqual(original);
	});

	it("rejects a tampered payload", () => {
		const encoded = encodeSession(session(), key);
		const [payload, signature] = encoded.split(".");
		// Re-encode the payload granting an extra guild, keeping the old signature.
		const forged = Buffer.from(
			JSON.stringify(session({ guildIds: [GUILD, OTHER_GUILD] })),
			"utf8",
		).toString("base64url");
		expect(decodeSession(`${forged}.${signature}`, key)).toBeNull();
		expect(payload).not.toEqual(forged);
	});

	it("rejects a session signed with a different master key", () => {
		const other = parseMasterKey(randomBytes(32).toString("hex"));
		expect(decodeSession(encodeSession(session(), other), key)).toBeNull();
	});

	it("rejects an expired session", () => {
		expect(
			decodeSession(encodeSession(session({ expiresAt: Date.now() - 1 }), key), key),
		).toBeNull();
	});

	it("rejects malformed input", () => {
		expect(decodeSession(undefined, key)).toBeNull();
		expect(decodeSession("", key)).toBeNull();
		expect(decodeSession("no-dot", key)).toBeNull();
		expect(decodeSession("...", key)).toBeNull();
	});

	it("leaves a normal session untouched by the cookie budget", () => {
		const original = session();
		expect(fitCookieBudget(original, key)).toEqual(original);
	});

	it("fits a user who manages many servers under the browser cookie limit", () => {
		// 200 servers with long, multi-byte names: far past 4 KB when stored whole.
		const guilds = Array.from({ length: 200 }, (_, i) => ({
			id: String(100000000000000000n + BigInt(i)),
			name: `🚀 ${"Very Long Server Name ".repeat(5)}${i}`,
		}));
		const big = session({ guilds, guildIds: guilds.map((g) => g.id) });
		expect(encodeSession(big, key).length).toBeGreaterThan(4096);

		const fitted = fitCookieBudget(big, key);
		const encoded = encodeSession(fitted, key);

		expect(encoded.length).toBeLessThanOrEqual(3600);
		expect(fitted.guilds.length).toBeGreaterThan(0);
		expect(fitted.guildIds).toEqual(fitted.guilds.map((g) => g.id));
		// Still a valid session that decodes, with names cut on a code point boundary.
		expect(decodeSession(encoded, key)?.guilds[0]?.name.startsWith("🚀")).toBe(true);
	});
});

describe("dashboard routes", () => {
	let dir: string;
	let db: DbHandle;
	let app: FastifyInstance;
	let masterKey: Buffer;

	async function build(env: NodeJS.ProcessEnv): Promise<FastifyInstance> {
		resetEnvCache();
		const parsed = loadEnv(env);
		return createServer({
			env: parsed,
			logger: createLogger(parsed),
			repository: db.repository,
			masterKey,
			discord: { channels: { fetch: async () => null } } as unknown as Client,
			ready: true,
			renderDefaults: { locale: "en", theme: "default", mode: "detailed" },
		});
	}

	function cookieFor(guildIds: string[], csrfToken = createCsrfToken()): string {
		const session: DashboardSession = {
			userId: "1",
			username: "ada",
			avatarUrl: null,
			guildIds,
			guilds: guildIds.map((id) => ({ id, name: "Acme" })),
			csrfToken,
			expiresAt: Date.now() + 60_000,
		};
		return `${COOKIE}=${encodeSession(session, masterKey)}`;
	}

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "githubot-dash-"));
		const url = `file:${join(dir, "test.db")}`;
		await migrate(url);
		db = createDb(url);
		masterKey = parseMasterKey(randomBytes(32).toString("hex"));

		await db.repository.ensureGuild(GUILD);
		await db.repository.addRepo({
			guildId: GUILD,
			owner: "acme",
			repo: "app",
			channelId: "channel-1",
			trackingId: "track-1",
			encryptedSecret: encryptSecret("s", masterKey),
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});
	});

	afterEach(async () => {
		await app?.close();
		await db.close();
		rmSync(dir, { recursive: true, force: true });
		resetEnvCache();
	});

	it("serves no dashboard route at all when disabled", async () => {
		app = await build({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
		const res = await app.inject({ method: "GET", url: "/dashboard" });
		expect(res.statusCode).toBe(404);
	});

	it("explains itself when enabled but not configured", async () => {
		app = await build({ NODE_ENV: "test", DASHBOARD_ENABLED: "true" } as NodeJS.ProcessEnv);
		const res = await app.inject({ method: "GET", url: "/dashboard" });
		expect(res.statusCode).toBe(503);
		expect(res.body).toContain("Dashboard is off");
		expect(res.body).toContain("DASHBOARD_BASE_URL");
	});

	it("shows the sign-in page to an anonymous visitor", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({ method: "GET", url: "/dashboard" });
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain("Continue with Discord");
	});

	it("sends a signed-in user to their first guild", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: "/dashboard",
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe(`/dashboard/g/${GUILD}`);
	});

	it("renders the overview with the tracked repository", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}`,
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain("acme/app");
		expect(res.body).toContain("Overview");
		expect(res.body).toContain("DELIVERED");
	});

	it("refuses a guild the session does not manage", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${OTHER_GUILD}`,
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.statusCode).toBe(403);
	});

	it("refuses a repository in a guild the session does not manage", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}/r/acme/app`,
			headers: { cookie: cookieFor([OTHER_GUILD]) },
		});
		expect(res.statusCode).toBe(403);
	});

	it("treats a tampered session cookie as signed out", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}`,
			headers: { cookie: `${COOKIE}=not.a.real.session` },
		});
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe("/dashboard");
	});

	it("rejects an OAuth callback with no state cookie", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: "/dashboard/auth/callback?code=abc&state=xyz",
		});
		expect(res.statusCode).toBe(400);
	});

	it("rejects an OAuth callback whose state does not match the cookie", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: "/dashboard/auth/callback?code=abc&state=attacker-value",
			headers: { cookie: "githubot_oauth_state=the-real-value" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("sets an httpOnly state cookie when starting sign-in", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({ method: "GET", url: "/dashboard/login" });
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toContain("discord.com/api/v10/oauth2/authorize");
		expect(res.headers.location).toContain("scope=identify+guilds");
		const cookie = String(res.headers["set-cookie"]);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Secure");
	});

	it("refuses a pause without a valid CSRF token", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "POST",
			url: `/dashboard/g/${GUILD}/r/acme/app/pause`,
			headers: { cookie: cookieFor([GUILD]), "content-type": "application/x-www-form-urlencoded" },
			payload: "csrf=wrong-token",
		});
		expect(res.statusCode).toBe(403);
		const after = await db.repository.getRepo(GUILD, "acme", "app");
		expect(after?.paused).toBe(false);
	});

	it("pauses and resumes with a valid CSRF token", async () => {
		app = await build(DASHBOARD_ENV);
		const csrf = createCsrfToken();
		const cookie = cookieFor([GUILD], csrf);

		const paused = await app.inject({
			method: "POST",
			url: `/dashboard/g/${GUILD}/r/acme/app/pause`,
			headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
			payload: `csrf=${encodeURIComponent(csrf)}`,
		});
		expect(paused.statusCode).toBe(302);
		expect((await db.repository.getRepo(GUILD, "acme", "app"))?.paused).toBe(true);

		const resumed = await app.inject({
			method: "POST",
			url: `/dashboard/g/${GUILD}/r/acme/app/resume`,
			headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
			payload: `csrf=${encodeURIComponent(csrf)}`,
		});
		expect(resumed.statusCode).toBe(302);
		expect((await db.repository.getRepo(GUILD, "acme", "app"))?.paused).toBe(false);
	});

	it("never exposes the webhook secret", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}/r/acme/app`,
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.statusCode).toBe(200);
		const stored = await db.repository.getRepo(GUILD, "acme", "app");
		expect(stored?.encryptedSecret).toBeTruthy();
		// The decrypting key never leaves the process and the ciphertext never renders.
		expect(res.body).not.toContain(stored?.encryptedSecret);
		expect(res.body).not.toContain("Payload URL");
		expect(res.body).not.toContain("regenerate");
	});

	it("truncates the tracking id rather than printing the payload path", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}/r/acme/app`,
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.body).not.toContain("/webhooks/github/");
	});

	it("escapes hostile text coming from GitHub error messages", async () => {
		// lastError is written from Discord/driver output, which can carry repository
		// text. It renders inside the page, so it must never break out of the markup.
		await db.repository.recordDeliveryResult({
			trackingId: "track-1",
			success: false,
			error: '</span><script>alert("xss")</script><span>',
		});

		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}/r/acme/app`,
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).not.toContain("<script>alert");
		expect(res.body).toContain("&lt;script&gt;");
	});

	it("sends hardening headers on every dashboard response", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}`,
			headers: { cookie: cookieFor([GUILD]) },
		});

		const csp = String(res.headers["content-security-policy"]);
		// The page ships no JavaScript, so nothing may execute even if escaping fails.
		expect(csp).toContain("script-src 'none'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("form-action 'self'");
		expect(res.headers["x-content-type-options"]).toBe("nosniff");
		expect(res.headers["x-frame-options"]).toBe("DENY");
		expect(res.headers["referrer-policy"]).toBe("no-referrer");
		// Per-user data behind a cookie must never be cached by a proxy.
		expect(String(res.headers["cache-control"])).toContain("no-store");
		expect(res.headers["strict-transport-security"]).toContain("max-age=");
	});

	it("uses the __Host- cookie prefix over https", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({ method: "GET", url: "/dashboard/login" });
		expect(String(res.headers["set-cookie"])).toContain("__Host-githubot_oauth_state=");
	});

	it("does not use the __Host- prefix on plain http, where it would be rejected", async () => {
		app = await build({ ...DASHBOARD_ENV, DASHBOARD_BASE_URL: "http://localhost:4321" });
		const res = await app.inject({ method: "GET", url: "/dashboard/login" });
		const cookie = String(res.headers["set-cookie"]);
		expect(cookie).toContain("githubot_oauth_state=");
		expect(cookie).not.toContain("__Host-");
		expect(cookie).not.toContain("Secure");
	});

	it("does not let the dashboard's form parser reach the webhook endpoint", async () => {
		app = await build(DASHBOARD_ENV);
		// The dashboard's permissive urlencoded parser lives in its own encapsulated
		// scope. The webhook has a GitHub-specific one that only accepts a `payload`
		// field, so an arbitrary form body is refused rather than parsed.
		const res = await app.inject({
			method: "POST",
			url: "/webhooks/github/track-1",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			payload: "a=1",
		});
		expect(res.statusCode).toBe(400);
		expect(res.json()).toMatchObject({ error: "Form body has no payload field" });
	});

	it("clears the session on sign out", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: "/dashboard/logout",
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.statusCode).toBe(302);
		expect(readCookie(String(res.headers["set-cookie"]), COOKIE)).toBe("");
	});
});
