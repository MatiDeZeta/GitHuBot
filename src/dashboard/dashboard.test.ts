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
	createCsrfToken,
	type DashboardSession,
	decodeSession,
	encodeSession,
	readCookie,
	SESSION_COOKIE,
} from "./session.js";

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
		return `${SESSION_COOKIE}=${encodeSession(session, masterKey)}`;
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
		expect(res.body).toContain("Instance health");
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
			headers: { cookie: `${SESSION_COOKIE}=not.a.real.session` },
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

	it("clears the session on sign out", async () => {
		app = await build(DASHBOARD_ENV);
		const res = await app.inject({
			method: "GET",
			url: "/dashboard/logout",
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(res.statusCode).toBe(302);
		expect(readCookie(String(res.headers["set-cookie"]), SESSION_COOKIE)).toBe("");
	});
});
