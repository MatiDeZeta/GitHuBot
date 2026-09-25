import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Env, loadEnv, resetEnvCache } from "../config/env.js";
import { DEFAULT_ENABLED_EVENTS } from "../config/events.js";
import { createLogger } from "../config/logger.js";
import { encryptSecret, parseMasterKey } from "../crypto/secrets.js";
import { createDb, type DbHandle, migrate } from "../db/index.js";
import { createServer } from "./app.js";

const SECRET = "s3cret-webhook-value";
const TRACKING_ID = "track-1";

function sign(body: string, secret = SECRET): string {
	return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** A push payload that renders, so only pause/enablement gates it. */
function pushBody(): string {
	return JSON.stringify({
		ref: "refs/heads/main",
		compare: "https://github.com/acme/app/compare/abc...def",
		commits: [
			{
				id: "abcdef1234567890",
				message: "feat: add thing",
				url: "https://github.com/acme/app/commit/abcdef1234567890",
			},
		],
		repository: {
			full_name: "acme/app",
			html_url: "https://github.com/acme/app",
			name: "app",
			owner: { login: "acme" },
		},
	});
}

describe("webhook endpoint", () => {
	let dir: string;
	let db: DbHandle;
	let app: FastifyInstance;
	let env: Env;
	let masterKey: Buffer;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "githubot-http-"));
		const url = `file:${join(dir, "test.db")}`;
		await migrate(url);
		db = createDb(url);

		masterKey = parseMasterKey(randomBytes(32).toString("hex"));
		await db.repository.ensureGuild("guild-1");
		await db.repository.addRepo({
			guildId: "guild-1",
			owner: "acme",
			repo: "app",
			channelId: "channel-1",
			trackingId: TRACKING_ID,
			encryptedSecret: encryptSecret(SECRET, masterKey),
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});
		// Pausing exercises signature + dedupe + dispatch without needing a live Discord client.
		await db.repository.setPaused("guild-1", "acme", "app", true);

		resetEnvCache();
		env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
		app = await createServer({
			env,
			logger: createLogger(env),
			repository: db.repository,
			masterKey,
			// Every channel lookup misses, so an unpaused delivery ends as `bad_channel`.
			discord: { channels: { fetch: async () => null } } as unknown as Client,
			ready: true,
			renderDefaults: { locale: "en", theme: "default", mode: "detailed" },
		});
	});

	afterEach(async () => {
		await app.close();
		await db.close();
		rmSync(dir, { recursive: true, force: true });
		resetEnvCache();
	});

	function post(body: string, headers: Record<string, string>) {
		return app.inject({
			method: "POST",
			url: `/webhooks/github/${TRACKING_ID}`,
			headers: { "content-type": "application/json", ...headers },
			payload: body,
		});
	}

	it("accepts a correctly signed delivery", async () => {
		const body = pushBody();
		const res = await post(body, {
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			"x-hub-signature-256": sign(body),
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ ok: true, reason: "paused" });
	});

	it("accepts GitHub's default form-encoded content type", async () => {
		const body = `payload=${encodeURIComponent(pushBody())}`;
		const res = await post(body, {
			"content-type": "application/x-www-form-urlencoded",
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			// GitHub signs the form body exactly as sent, not the JSON inside it.
			"x-hub-signature-256": sign(body),
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ ok: true, reason: "paused" });
	});

	it("rejects a form-encoded delivery whose payload was altered after signing", async () => {
		const body = `payload=${encodeURIComponent(pushBody())}`;
		const res = await post(body.replace("acme", "evil"), {
			"content-type": "application/x-www-form-urlencoded",
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			"x-hub-signature-256": sign(body),
		});
		expect(res.statusCode).toBe(401);
	});

	it("still refuses content types GitHub never sends", async () => {
		const body = pushBody();
		const res = await post(body, {
			"content-type": "application/xml",
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			"x-hub-signature-256": sign(body),
		});
		expect(res.statusCode).toBe(415);
	});

	it("rejects a bad signature without touching the database", async () => {
		const body = pushBody();
		const res = await post(body, {
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			"x-hub-signature-256": sign(body, "wrong-secret"),
		});
		expect(res.statusCode).toBe(401);
	});

	it("rejects a payload whose body was tampered with after signing", async () => {
		const signature = sign(pushBody());
		const res = await post(pushBody().replace("acme/app", "evil/app"), {
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			"x-hub-signature-256": signature,
		});
		expect(res.statusCode).toBe(401);
	});

	it("404s an unknown tracking id", async () => {
		const body = pushBody();
		const res = await app.inject({
			method: "POST",
			url: "/webhooks/github/not-a-real-tracking-id",
			headers: {
				"content-type": "application/json",
				"x-github-event": "push",
				"x-github-delivery": randomUUID(),
				"x-hub-signature-256": sign(body),
			},
			payload: body,
		});
		expect(res.statusCode).toBe(404);
	});

	it("400s when GitHub headers are missing", async () => {
		const body = pushBody();
		const res = await post(body, { "x-hub-signature-256": sign(body) });
		expect(res.statusCode).toBe(400);
	});

	it("treats a replayed delivery id as a duplicate", async () => {
		const body = pushBody();
		const deliveryId = randomUUID();
		const headers = {
			"x-github-event": "push",
			"x-github-delivery": deliveryId,
			"x-hub-signature-256": sign(body),
		};

		const first = await post(body, headers);
		const second = await post(body, headers);

		expect(first.json()).not.toMatchObject({ duplicate: true });
		expect(second.statusCode).toBe(200);
		expect(second.json()).toMatchObject({ ok: true, duplicate: true });
	});

	it("collapses concurrent replays of one delivery id to a single record", async () => {
		const body = pushBody();
		const deliveryId = randomUUID();
		const headers = {
			"x-github-event": "push",
			"x-github-delivery": deliveryId,
			"x-hub-signature-256": sign(body),
		};

		const results = await Promise.all([
			post(body, headers),
			post(body, headers),
			post(body, headers),
		]);

		// The race must not surface as a 500 from a unique-constraint violation.
		expect(results.every((res) => res.statusCode === 200)).toBe(true);
		expect(results.filter((res) => res.json().duplicate === true)).toHaveLength(2);
	});
	it("still verifies the current secret when the previous one predates a MASTER_KEY change", async () => {
		// `/repo regenerate-secret` after a key change used to leave a previous secret
		// that no longer decrypts; that aborted every delivery with a 500.
		const staleKey = parseMasterKey(randomBytes(32).toString("hex"));
		await db.repository.rotateSecret({
			guildId: "guild-1",
			owner: "acme",
			repo: "app",
			encryptedSecret: encryptSecret("rotated-secret", masterKey),
			encryptedPreviousSecret: encryptSecret(SECRET, staleKey),
		});

		const body = pushBody();
		const res = await post(body, {
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			"x-hub-signature-256": sign(body, "rotated-secret"),
		});
		expect(res.statusCode).toBe(200);
		expect((await db.repository.getRepo("guild-1", "acme", "app"))?.encryptedPreviousSecret).toBe(
			null,
		);
	});

	it("lets GitHub redeliver a delivery that never reached Discord", async () => {
		await db.repository.setPaused("guild-1", "acme", "app", false);
		const body = pushBody();
		const headers = {
			"x-github-event": "push",
			"x-github-delivery": randomUUID(),
			"x-hub-signature-256": sign(body),
		};

		const first = await post(body, headers);
		expect(first.json()).toMatchObject({ delivered: false, reason: "bad_channel" });

		// Redeliver reuses the X-GitHub-Delivery id; it must be attempted again.
		const redelivery = await post(body, headers);
		expect(redelivery.json()).not.toMatchObject({ duplicate: true });
		expect(redelivery.json()).toMatchObject({ reason: "bad_channel" });
	});
});

describe("metrics endpoint", () => {
	async function serverWith(overrides: Partial<NodeJS.ProcessEnv>) {
		resetEnvCache();
		const env = loadEnv({ NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv);
		return createServer({
			env,
			logger: createLogger(env),
			repository: null,
			masterKey: null,
			discord: null,
			ready: false,
			renderDefaults: { locale: "en", theme: "default", mode: "detailed" },
		});
	}

	afterEach(() => resetEnvCache());

	it("is public when no token is configured", async () => {
		const app = await serverWith({});
		const res = await app.inject({ method: "GET", url: "/metrics" });
		expect(res.statusCode).toBe(200);
		await app.close();
	});

	it("requires a bearer token when one is configured", async () => {
		const token = "a-sufficiently-long-metrics-token";
		const app = await serverWith({ METRICS_TOKEN: token });

		const anonymous = await app.inject({ method: "GET", url: "/metrics" });
		expect(anonymous.statusCode).toBe(401);

		const wrong = await app.inject({
			method: "GET",
			url: "/metrics",
			headers: { authorization: "Bearer not-the-right-token-value-x" },
		});
		expect(wrong.statusCode).toBe(401);

		const authorized = await app.inject({
			method: "GET",
			url: "/metrics",
			headers: { authorization: `Bearer ${token}` },
		});
		expect(authorized.statusCode).toBe(200);

		// /health must stay reachable for platform health checks.
		const health = await app.inject({ method: "GET", url: "/health" });
		expect(health.statusCode).toBe(200);
		await app.close();
	});

	it("rate-limits webhook deliveries before reading the body", async () => {
		const app = await serverWith({ WEBHOOK_RATE_LIMIT: "2" });
		const deliver = () =>
			app.inject({
				method: "POST",
				url: "/webhooks/github/anything",
				headers: {
					"content-type": "application/json",
					"x-github-event": "push",
					"x-github-delivery": randomUUID(),
				},
				// Unparseable on purpose: a 429 here proves the limit ran first.
				payload: "{not json",
			});

		expect((await deliver()).statusCode).toBe(400);
		expect((await deliver()).statusCode).toBe(400);
		expect((await deliver()).statusCode).toBe(429);
		await app.close();
	});

	it("rejects an oversized body before parsing it", async () => {
		const app = await serverWith({ WEBHOOK_BODY_LIMIT: "1024" });
		const res = await app.inject({
			method: "POST",
			url: "/webhooks/github/anything",
			headers: {
				"content-type": "application/json",
				"x-github-event": "push",
				"x-github-delivery": randomUUID(),
			},
			payload: JSON.stringify({ padding: "x".repeat(4096) }),
		});
		expect(res.statusCode).toBe(413);
		await app.close();
	});
});
