import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelType, type Client } from "discord.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "../config/env.js";
import { DEFAULT_ENABLED_EVENTS } from "../config/events.js";
import { createLogger } from "../config/logger.js";
import { encryptSecret, parseMasterKey } from "../crypto/secrets.js";
import { createDb, type DbHandle, migrate } from "../db/index.js";
import { createServer, type ServerContext } from "../server/app.js";
import { resetPermissionCache } from "./directory.js";
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

const CHANNEL = "444444444444444444";
const SECOND_CHANNEL = "444444444444444445";
/** A real channel the bot can see, but in a different server. */
const FOREIGN_CHANNEL = "555555555555555555";
const ROLE = "666666666666666666";

/**
 * Just enough of discord.js for the dashboard: one server with two channels and a
 * role, a channel belonging to another server, and a member lookup whose answer
 * the test controls.
 */
function fakeDiscord(options: { manages?: boolean } = {}): Client {
	const channel = (id: string, name: string, guildId: string) => ({
		id,
		name,
		guildId,
		type: ChannelType.GuildText,
		rawPosition: 0,
	});
	const own = [channel(CHANNEL, "changelog", GUILD), channel(SECOND_CHANNEL, "ci", GUILD)];
	const all = new Map(
		[...own, channel(FOREIGN_CHANNEL, "elsewhere", OTHER_GUILD)].map((c) => [c.id, c]),
	);
	const guild = {
		id: GUILD,
		ownerId: "999",
		channels: { cache: new Map(own.map((c) => [c.id, c])) },
		roles: {
			cache: new Map([[ROLE, { id: ROLE, name: "devs", managed: false, position: 1 }]]),
		},
		members: { fetch: async () => ({ permissions: { has: () => options.manages ?? true } }) },
	};
	return {
		guilds: { cache: new Map([[GUILD, guild]]) },
		channels: { cache: all, fetch: async (id: string) => all.get(id) ?? null },
	} as unknown as Client;
}

const FORM = { "content-type": "application/x-www-form-urlencoded" };

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

	async function build(
		env: NodeJS.ProcessEnv,
		discord: Client = fakeDiscord(),
	): Promise<FastifyInstance> {
		resetEnvCache();
		const parsed = loadEnv(env);
		return createServer({
			env: parsed,
			logger: createLogger(parsed),
			repository: db.repository,
			masterKey,
			discord,
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
		resetPermissionCache();

		await db.repository.ensureGuild(GUILD);
		await db.repository.addRepo({
			guildId: GUILD,
			owner: "acme",
			repo: "app",
			channelId: CHANNEL,
			trackingId: "track-1",
			encryptedSecret: encryptSecret("the-webhook-secret", masterKey),
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});
	});

	afterEach(async () => {
		await app?.close();
		await db.close();
		rmSync(dir, { recursive: true, force: true });
		resetEnvCache();
	});

	it("serves the dashboard once the stack that boots after the server is ready", async () => {
		// Production order: the server is created first, with nothing started yet.
		resetEnvCache();
		const parsed = loadEnv(DASHBOARD_ENV);
		const ctx: ServerContext = {
			env: parsed,
			logger: createLogger(parsed),
			repository: null,
			masterKey: null,
			discord: null,
			ready: false,
			renderDefaults: { locale: "en", theme: "default", mode: "detailed" },
		};
		const late = await createServer(ctx);

		const starting = await late.inject({ method: "GET", url: "/dashboard" });
		expect(starting.statusCode).toBe(503);
		expect(starting.headers["retry-after"]).toBe("15");
		expect(starting.headers["content-security-policy"]).toContain("script-src 'self'");

		ctx.repository = db.repository;
		ctx.masterKey = masterKey;
		ctx.discord = fakeDiscord();
		ctx.ready = true;

		const signIn = await late.inject({ method: "GET", url: "/dashboard" });
		expect(signIn.statusCode).toBe(200);
		const page = await late.inject({
			method: "GET",
			url: `/dashboard/g/${GUILD}`,
			headers: { cookie: cookieFor([GUILD]) },
		});
		expect(page.statusCode).toBe(200);
		await late.close();
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
		expect(res.body).toContain("Deliveries received");
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

	it("flags a repository GitHub reports under a different name", async () => {
		app = await build(DASHBOARD_ENV);
		const url = `/dashboard/g/${GUILD}/r/acme/app`;
		const headers = { cookie: cookieFor([GUILD]) };

		const before = await app.inject({ method: "GET", url, headers });
		expect(before.body).not.toContain("GitHub reports a different repository");

		await db.repository.setObservedFullName("track-1", "acme/app-renamed");
		const after = await app.inject({ method: "GET", url, headers });
		expect(after.statusCode).toBe(200);
		expect(after.body).toContain("GitHub reports a different repository");
		expect(after.body).toContain("acme/app-renamed");
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
		// Only this origin's own files may run or style the page: nothing inline, so
		// an escaping mistake still cannot execute anything.
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("style-src 'self'");
		expect(csp).not.toContain("unsafe-inline");
		expect(csp).not.toContain("unsafe-eval");
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
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				"x-github-event": "push",
				"x-github-delivery": "5c2b7e52-0d55-4d6f-9a56-6f2f4e3f9a10",
				"x-hub-signature-256": "sha256=00",
			},
			payload: "a=1",
		});
		expect(res.statusCode).toBe(400);
		expect(res.json()).toMatchObject({ error: "Form body has no payload field" });
	});

	it("clears the session on sign out, and only for a POST carrying the form token", async () => {
		app = await build(DASHBOARD_ENV);
		const csrf = createCsrfToken();
		const cookie = cookieFor([GUILD], csrf);

		// A GET could be fired by any page that embeds the URL as an image.
		const get = await app.inject({ method: "GET", url: "/dashboard/logout", headers: { cookie } });
		expect(get.statusCode).toBe(404);

		const forged = await app.inject({
			method: "POST",
			url: "/dashboard/logout",
			headers: { cookie, ...FORM },
			payload: "csrf=nope",
		});
		expect(forged.statusCode).toBe(403);

		const res = await app.inject({
			method: "POST",
			url: "/dashboard/logout",
			headers: { cookie, ...FORM },
			payload: `csrf=${encodeURIComponent(csrf)}`,
		});
		expect(res.statusCode).toBe(302);
		expect(readCookie(String(res.headers["set-cookie"]), COOKIE)).toBe("");
	});

	describe("v2", () => {
		const repoUrl = `/dashboard/g/${GUILD}/r/acme/app`;
		let csrf: string;
		let cookie: string;

		beforeEach(() => {
			csrf = createCsrfToken();
			cookie = cookieFor([GUILD], csrf);
		});

		const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
		const post = (url: string, fields: [string, string][] = []) =>
			app.inject({
				method: "POST",
				url,
				headers: { cookie, ...FORM },
				payload: new URLSearchParams([["csrf", csrf], ...fields]).toString(),
			});
		const stored = async () => {
			const repo = await db.repository.getRepo(GUILD, "acme", "app");
			if (!repo) throw new Error("repository missing");
			return repo;
		};

		it("renders every page without an inline style, script or handler", async () => {
			app = await build(DASHBOARD_ENV);
			const pages = [
				`/dashboard/g/${GUILD}`,
				`/dashboard/g/${GUILD}/repos`,
				`/dashboard/g/${GUILD}/repos/new`,
				`/dashboard/g/${GUILD}/activity`,
				`/dashboard/g/${GUILD}/settings`,
				repoUrl,
				...["events", "filters", "routing", "appearance", "webhook", "deliveries"].map(
					(tab) => `${repoUrl}?tab=${tab}`,
				),
			];
			for (const url of pages) {
				const res = await get(url);
				expect(res.statusCode, url).toBe(200);
				// The CSP would block these anyway; this keeps the page from depending on them.
				expect(res.body, url).not.toMatch(/\sstyle\s*=/i);
				expect(res.body, url).not.toMatch(/\son[a-z]+\s*=/i);
				expect(res.body, url).not.toMatch(/<script(?![^>]*\ssrc=)/i);
				expect(res.body, url).not.toContain("<style");
			}
		});

		it("serves its stylesheet and script as cacheable files from its own origin", async () => {
			app = await build(DASHBOARD_ENV);
			const page = await get(`/dashboard/g/${GUILD}`);
			const css = /href="(\/dashboard\/assets\/app\.[0-9a-f]+\.css)"/.exec(page.body)?.[1];
			const js = /src="(\/dashboard\/assets\/app\.[0-9a-f]+\.js)"/.exec(page.body)?.[1];
			expect(css).toBeDefined();
			expect(js).toBeDefined();

			const sheet = await app.inject({ method: "GET", url: css ?? "" });
			expect(sheet.statusCode).toBe(200);
			expect(sheet.headers["content-type"]).toContain("text/css");
			expect(String(sheet.headers["cache-control"])).toContain("immutable");
			const script = await app.inject({ method: "GET", url: js ?? "" });
			expect(script.statusCode).toBe(200);
			expect(script.headers["content-type"]).toContain("javascript");
			expect(script.headers["x-content-type-options"]).toBe("nosniff");

			const stale = await app.inject({
				method: "GET",
				url: "/dashboard/assets/app.000000000000.js",
			});
			expect(stale.statusCode).toBe(404);
		});

		it("refuses every change once Discord says Manage Server is gone", async () => {
			app = await build(DASHBOARD_ENV, fakeDiscord({ manages: false }));
			// The session is still valid — it was issued while the permission was held.
			expect((await get(repoUrl)).statusCode).toBe(200);

			const res = await post(`${repoUrl}/pause`);
			expect(res.statusCode).toBe(403);
			expect(res.body).toContain("no longer have Manage Server");
			expect((await stored()).paused).toBe(false);

			const removed = await post(`${repoUrl}/remove`, [["confirm", "yes"]]);
			expect(removed.statusCode).toBe(403);
			expect(await db.repository.getRepo(GUILD, "acme", "app")).not.toBeNull();
		});

		it("shuts out a session once DISCORD_ALLOWED_USER_ID names someone else", async () => {
			app = await build({ ...DASHBOARD_ENV, DISCORD_ALLOWED_USER_ID: "777777777777777777" });
			const res = await get(`/dashboard/g/${GUILD}`);
			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toBe("/dashboard");
		});

		it("adds a repository and shows its secret once, in the response to the POST", async () => {
			app = await build(DASHBOARD_ENV);
			const res = await post(`/dashboard/g/${GUILD}/repos/new`, [
				["repository", "acme/website"],
				["channel", SECOND_CHANNEL],
			]);
			expect(res.statusCode).toBe(200);
			expect(res.body).toContain("Webhook secret");

			const added = await db.repository.getRepo(GUILD, "acme", "website");
			expect(added?.channelId).toBe(SECOND_CHANNEL);
			expect(res.body).toContain(`/webhooks/github/${added?.trackingId}`);
			const secret = /id="secret" type="password" value="([0-9a-f]{64})"/.exec(res.body)?.[1];
			expect(secret).toBeDefined();

			// Any later page view has no secret in it.
			const later = await get(`/dashboard/g/${GUILD}/r/acme/website?tab=webhook`);
			expect(later.body).not.toContain(secret);
		});

		it("refuses a duplicate, a malformed name and a channel from another server", async () => {
			app = await build(DASHBOARD_ENV);
			const add = (repository: string, channel: string) =>
				post(`/dashboard/g/${GUILD}/repos/new`, [
					["repository", repository],
					["channel", channel],
				]);

			expect((await add("ACME/App", CHANNEL)).statusCode).toBe(409);
			expect((await add("not a repo", CHANNEL)).statusCode).toBe(400);

			const foreign = await add("acme/other", FOREIGN_CHANNEL);
			expect(foreign.statusCode).toBe(400);
			expect(await db.repository.getRepo(GUILD, "acme", "other")).toBeNull();
		});

		it("saves the event checklist, dropping names that are not events", async () => {
			app = await build(DASHBOARD_ENV);
			const res = await post(`${repoUrl}/events`, [
				["events", "release"],
				["events", "push"],
				["events", "definitely_not_an_event"],
			]);
			expect(res.statusCode).toBe(302);
			expect((await stored()).enabledEvents).toEqual(["push", "release"]);

			await post(`${repoUrl}/events`, [["preset", "everything"]]);
			expect((await stored()).enabledEvents.length).toBeGreaterThan(40);

			await post(`${repoUrl}/events`);
			expect((await stored()).enabledEvents).toEqual([]);
		});

		it("saves filters from comma-separated fields", async () => {
			app = await build(DASHBOARD_ENV);
			await post(`${repoUrl}/filters`, [
				["branchInclude", "main, release/*"],
				["branchExclude", ""],
				["labels", "bug"],
				["ignoredActors", "bot, renovate*"],
			]);
			expect((await stored()).filters).toEqual({
				branchInclude: ["main", "release/*"],
				branchExclude: [],
				labels: ["bug"],
				ignoredActors: ["bot", "renovate*"],
			});
		});

		it("routes a category and sets a ping, and clears both again", async () => {
			app = await build(DASHBOARD_ENV);
			await post(`${repoUrl}/routing`, [
				["route.cicd", SECOND_CHANNEL],
				["mention.security", ROLE],
			]);
			let repo = await stored();
			expect(repo.eventRoutes).toEqual({ cicd: SECOND_CHANNEL });
			expect(repo.mentionRules).toEqual({ security: [ROLE] });

			await post(`${repoUrl}/routing`);
			repo = await stored();
			expect(repo.eventRoutes).toEqual({});
			expect(repo.mentionRules).toEqual({});
		});

		it("never points a repository at a channel or role outside its own server", async () => {
			app = await build(DASHBOARD_ENV);

			const route = await post(`${repoUrl}/routing`, [["route.cicd", FOREIGN_CHANNEL]]);
			expect(route.headers.location).toContain("notice=bad_channel");
			const role = await post(`${repoUrl}/routing`, [["mention.cicd", GUILD]]);
			expect(role.headers.location).toContain("notice=bad_role");
			const channel = await post(`${repoUrl}/channel`, [["channel", FOREIGN_CHANNEL]]);
			expect(channel.headers.location).toContain("notice=bad_channel");
			const alerts = await post(`/dashboard/g/${GUILD}/settings/alerts`, [
				["channel", FOREIGN_CHANNEL],
			]);
			expect(alerts.headers.location).toContain("notice=bad_channel");

			const repo = await stored();
			expect(repo.channelId).toBe(CHANNEL);
			expect(repo.eventRoutes).toEqual({});
			expect(repo.mentionRules).toEqual({});
			expect((await db.repository.getGuildSettings(GUILD))?.alertChannelId ?? null).toBeNull();
		});

		it("changes the default channel", async () => {
			app = await build(DASHBOARD_ENV);
			await post(`${repoUrl}/channel`, [["channel", SECOND_CHANNEL]]);
			expect((await stored()).channelId).toBe(SECOND_CHANNEL);
		});

		it("sets and clears a repository's appearance", async () => {
			app = await build(DASHBOARD_ENV);
			await post(`${repoUrl}/style`, [
				["theme", "nord"],
				["mode", "compact"],
				["locale", "es"],
			]);
			let repo = await stored();
			expect([repo.theme, repo.displayMode, repo.locale]).toEqual(["nord", "compact", "es"]);

			await post(`${repoUrl}/style`, [
				["theme", ""],
				["mode", "sideways"],
				["locale", ""],
			]);
			repo = await stored();
			expect([repo.theme, repo.displayMode, repo.locale]).toEqual([null, null, null]);
		});

		it("saves server defaults and the alert channel", async () => {
			app = await build(DASHBOARD_ENV);
			await post(`/dashboard/g/${GUILD}/settings/style`, [
				["theme", "github"],
				["mode", "compact"],
				["locale", "es"],
			]);
			await post(`/dashboard/g/${GUILD}/settings/alerts`, [["channel", SECOND_CHANNEL]]);
			expect(await db.repository.getGuildSettings(GUILD)).toMatchObject({
				defaultTheme: "github",
				defaultDisplayMode: "compact",
				locale: "es",
				alertChannelId: SECOND_CHANNEL,
			});

			await post(`/dashboard/g/${GUILD}/settings/alerts`, [["channel", ""]]);
			expect((await db.repository.getGuildSettings(GUILD))?.alertChannelId).toBeNull();
		});

		it("reveals the secret only to a POST carrying the form token", async () => {
			app = await build(DASHBOARD_ENV);
			expect((await get(`${repoUrl}?tab=webhook`)).body).not.toContain("the-webhook-secret");

			const forged = await app.inject({
				method: "POST",
				url: `${repoUrl}/secret/reveal`,
				headers: { cookie, ...FORM },
				payload: "csrf=guess",
			});
			expect(forged.statusCode).toBe(403);
			expect(forged.body).not.toContain("the-webhook-secret");

			const res = await post(`${repoUrl}/secret/reveal`);
			expect(res.statusCode).toBe(200);
			expect(res.body).toContain("the-webhook-secret");
			expect(String(res.headers["cache-control"])).toContain("no-store");
		});

		it("rotates the secret, keeping the old one as the fallback", async () => {
			app = await build(DASHBOARD_ENV);
			const before = await stored();
			const res = await post(`${repoUrl}/secret/rotate`);
			expect(res.statusCode).toBe(200);

			const after = await stored();
			expect(after.encryptedSecret).not.toBe(before.encryptedSecret);
			expect(after.encryptedPreviousSecret).toBe(before.encryptedSecret);
			expect(res.body).toMatch(/id="secret" type="password" value="[0-9a-f]{64}"/);
			expect(res.body).not.toContain("the-webhook-secret");
		});

		it("removes a repository only when the confirmation is ticked", async () => {
			app = await build(DASHBOARD_ENV);
			const unconfirmed = await post(`${repoUrl}/remove`);
			expect(unconfirmed.headers.location).toContain("notice=confirm");
			expect(await db.repository.getRepo(GUILD, "acme", "app")).not.toBeNull();

			const res = await post(`${repoUrl}/remove`, [["confirm", "yes"]]);
			expect(res.headers.location).toBe(`/dashboard/g/${GUILD}/repos?notice=removed`);
			expect(await db.repository.getRepo(GUILD, "acme", "app")).toBeNull();
		});

		it("shows the delivery log, filters it by outcome and escapes its detail", async () => {
			const entry = (outcome: "delivered" | "failed", event: string, detail: string | null) =>
				db.repository.recordDeliveryLog({
					trackingId: "track-1",
					deliveryId: randomBytes(8).toString("hex"),
					event,
					action: "opened",
					outcome,
					detail,
				});
			await entry("delivered", "pull_request", null);
			await entry("failed", "issues", '<img src=x onerror="alert(1)">');

			app = await build(DASHBOARD_ENV);
			const all = await get(`${repoUrl}?tab=deliveries`);
			expect(all.body).toContain("pull_request");
			expect(all.body).toContain("issues");
			expect(all.body).not.toContain("<img src=x");
			expect(all.body).toContain("&lt;img src=x");

			const failed = await get(`${repoUrl}?tab=deliveries&outcome=failed`);
			expect(failed.body).toContain("issues");
			expect(failed.body).not.toContain("pull_request");

			const server = await get(`/dashboard/g/${GUILD}/activity`);
			expect(server.body).toContain("acme/app");
			expect(server.body).toContain("pull_request");
		});

		it("does not show another server's deliveries", async () => {
			await db.repository.ensureGuild(OTHER_GUILD);
			await db.repository.addRepo({
				guildId: OTHER_GUILD,
				owner: "rival",
				repo: "secret-project",
				channelId: FOREIGN_CHANNEL,
				trackingId: "track-2",
				encryptedSecret: encryptSecret("s", masterKey),
				enabledEvents: [...DEFAULT_ENABLED_EVENTS],
			});
			await db.repository.recordDeliveryLog({
				trackingId: "track-2",
				deliveryId: "d-2",
				event: "deployment",
				action: null,
				outcome: "delivered",
				detail: null,
			});

			app = await build(DASHBOARD_ENV);
			for (const url of [`/dashboard/g/${GUILD}`, `/dashboard/g/${GUILD}/activity`]) {
				const res = await get(url);
				expect(res.body, url).not.toContain("secret-project");
				expect(res.body, url).not.toContain("deployment");
			}
			expect((await get(`/dashboard/g/${OTHER_GUILD}/r/rival/secret-project`)).statusCode).toBe(
				403,
			);
			expect((await get(`/dashboard/g/${GUILD}/r/rival/secret-project`)).statusCode).toBe(404);
		});

		it("draws a preview for the chosen theme and density", async () => {
			app = await build(DASHBOARD_ENV);
			const detailed = await get(`/dashboard/g/${GUILD}/preview?theme=nord&mode=detailed`);
			const compact = await get(`/dashboard/g/${GUILD}/preview?theme=nord&mode=compact`);
			expect(detailed.statusCode).toBe(200);
			expect(detailed.body).toContain('class="msgs"');
			expect(detailed.body.length).toBeGreaterThan(compact.body.length);
			expect(detailed.body).not.toMatch(/\sstyle\s*=/i);
		});

		it("filters the repository list on the server when scripting is off", async () => {
			app = await build(DASHBOARD_ENV);
			const hit = await get(`/dashboard/g/${GUILD}/repos?q=acme`);
			const miss = await get(`/dashboard/g/${GUILD}/repos?q=zzz`);
			expect(hit.body).toMatch(/<tr data-row [^>]*data-status="ok">/);
			expect(miss.body).toMatch(/<tr data-row [^>]*class="hidden">/);
		});
	});
});
