import { timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import type { Client } from "discord.js";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import Fastify, { type FastifyInstance } from "fastify";
import {
	type Env,
	isDashboardConfigured,
	isFullyConfigured,
	missingConfigKeys,
	missingDashboardKeys,
} from "../config/env.js";
import { githubEventToType } from "../config/events.js";
import type { Logger } from "../config/logger.js";
import { tryDecryptSecret } from "../crypto/secrets.js";
import { registerDashboard } from "../dashboard/routes.js";
import { notConfiguredPage } from "../dashboard/views.js";
import type { RepoRepository } from "../db/types.js";
import { type DispatchContext, type DispatchOutcome, dispatchEvent } from "../delivery/dispatch.js";
import { verifyGitHubSignature } from "../github/verify.js";
import { metrics } from "../metrics.js";

export interface ServerContext {
	env: Env;
	logger: Logger;
	repository: RepoRepository | null;
	masterKey: Buffer | null;
	discord: Client | null;
	ready: boolean;
	/** Render defaults resolved from the environment at boot. */
	renderDefaults: DispatchContext["defaults"];
}

declare module "fastify" {
	interface FastifyRequest {
		rawBody?: string;
	}
}

export async function createServer(ctx: ServerContext): Promise<FastifyInstance> {
	const app = Fastify({
		logger: false,
		bodyLimit: ctx.env.WEBHOOK_BODY_LIMIT,
		...(ctx.env.TRUST_PROXY !== undefined ? { trustProxy: ctx.env.TRUST_PROXY } : {}),
	});

	// Fastify's default handler echoes the underlying driver's message; scrub it.
	app.setErrorHandler((err: FastifyError, request, reply) => {
		const status = err.statusCode ?? 500;
		if (status >= 500) {
			ctx.logger.error({ err, url: request.url }, "Unhandled request error");
			return reply.code(status).send({ error: "Internal server error" });
		}
		return reply.code(status).send({ error: err.message });
	});

	app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
		const raw = typeof body === "string" ? body : body.toString("utf8");
		req.rawBody = raw;
		try {
			const json = raw.length > 0 ? JSON.parse(raw) : {};
			done(null, json);
		} catch {
			// A bare SyntaxError carries no status, so it surfaced as a 500 and an
			// error-level log that any unauthenticated caller could trigger at will.
			done(badRequest("Request body is not valid JSON"), undefined);
		}
	});

	// `onRequest` counts a request before its body is read. At `preHandler` a
	// flood was only refused after buffering up to WEBHOOK_BODY_LIMIT per request.
	// Route-level limits inherit this hook.
	await app.register(rateLimit, {
		max: 100,
		timeWindow: "1 minute",
		hook: "onRequest",
	});

	app.get("/health", async () => ({
		ok: true,
		service: "githubot",
		configured: isFullyConfigured(ctx.env) && ctx.ready,
		missing: missingConfigKeys(ctx.env),
	}));

	app.get("/metrics", async (request, reply) => {
		if (!metricsTokenMatches(ctx.env.METRICS_TOKEN, header(request, "authorization"))) {
			return reply.code(401).send({ error: "Unauthorized" });
		}
		const snapshot = metrics.snapshot();
		return {
			ok: true,
			uptimeMs: snapshot.uptimeMs,
			received: snapshot.received,
			delivered: snapshot.delivered,
			failed: snapshot.failed,
			filtered: snapshot.filtered,
			duplicates: snapshot.duplicates,
			deliveredToday: snapshot.deliveredToday,
		};
	});

	// Off unless explicitly enabled AND given OAuth credentials, so a default
	// deployment serves no dashboard route at all — not even a sign-in page.
	if (isDashboardConfigured(ctx.env)) {
		if (ctx.repository && ctx.masterKey && ctx.discord) {
			await registerDashboard(app, {
				env: ctx.env,
				logger: ctx.logger,
				repository: ctx.repository,
				masterKey: ctx.masterKey,
				discord: ctx.discord,
				renderDefaults: ctx.renderDefaults,
			});
			ctx.logger.info({ baseUrl: ctx.env.DASHBOARD_BASE_URL }, "Dashboard enabled");
		}
	} else if (ctx.env.DASHBOARD_ENABLED) {
		// Enabled but incomplete: say why on the route instead of 404ing silently.
		const missing = missingDashboardKeys(ctx.env);
		ctx.logger.warn({ missing }, "DASHBOARD_ENABLED is set but the dashboard is not configured");
		app.get("/dashboard", async (_request, reply) =>
			reply
				.code(503)
				.header("content-type", "text/html; charset=utf-8")
				.send(notConfiguredPage(missing)),
		);
	}

	// Encapsulated so its form parser applies to this route only; the dashboard
	// registers a different one for its own forms.
	await app.register(async (hooks: FastifyInstance) => {
		// GitHub's default content type. The body is `payload=<url-encoded JSON>` and
		// the signature covers it exactly as sent, so the raw string is kept for
		// verification and only the `payload` field is parsed.
		hooks.addContentTypeParser(
			"application/x-www-form-urlencoded",
			{ parseAs: "string" },
			(req, body, done) => {
				const raw = typeof body === "string" ? body : body.toString("utf8");
				req.rawBody = raw;
				const payload = new URLSearchParams(raw).get("payload");
				if (payload === null) {
					done(badRequest("Form body has no payload field"), undefined);
					return;
				}
				try {
					done(null, JSON.parse(payload));
				} catch {
					done(badRequest("Request body is not valid JSON"), undefined);
				}
			},
		);

		hooks.post<{ Params: { trackingId: string } }>(
			"/webhooks/github/:trackingId",
			{
				config: {
					rateLimit: {
						// GitHub delivers from a small pool of addresses and never retries a
						// 429, so this must clear a busy repository's CI bursts.
						max: ctx.env.WEBHOOK_RATE_LIMIT,
						timeWindow: "1 minute",
					},
				},
			},
			async (request, reply) => handleWebhook(request, reply, ctx),
		);
	});

	return app;
}

function badRequest(message: string): FastifyError {
	const error = new Error(message) as FastifyError;
	error.statusCode = 400;
	return error;
}

async function handleWebhook(
	request: FastifyRequest<{ Params: { trackingId: string } }>,
	reply: FastifyReply,
	ctx: ServerContext,
): Promise<FastifyReply> {
	if (!ctx.ready || !ctx.repository || !ctx.masterKey || !ctx.discord) {
		return reply.code(503).send({
			error: "Bot not fully configured",
			missing: missingConfigKeys(ctx.env),
		});
	}

	const repository = ctx.repository;
	const masterKey = ctx.masterKey;
	const discord = ctx.discord;

	const { trackingId } = request.params;
	const deliveryId = header(request, "x-github-delivery");
	const eventName = header(request, "x-github-event");
	const signature = header(request, "x-hub-signature-256");
	const rawBody = request.rawBody ?? "";

	if (!deliveryId || !eventName) {
		return reply.code(400).send({ error: "Missing GitHub webhook headers" });
	}

	const tracked = await repository.findByTrackingId(trackingId);
	if (!tracked) {
		ctx.logger.warn({ trackingId }, "Unknown tracking id");
		return reply.code(404).send({ error: "Unknown webhook" });
	}

	const secret = tryDecryptSecret(tracked.encryptedSecret, masterKey);
	if (secret === null) {
		ctx.logger.error({ trackingId }, "Failed to decrypt webhook secret");
		return reply.code(500).send({ error: "Server configuration error" });
	}

	// The previous secret only bridges a rotation. One stored under an earlier
	// MASTER_KEY can never match, so it must not block the current secret — that
	// is exactly the state `/repo regenerate-secret` leaves after a key change.
	const previousSecrets: string[] = [];
	if (tracked.encryptedPreviousSecret) {
		const previous = tryDecryptSecret(tracked.encryptedPreviousSecret, masterKey);
		if (previous === null) {
			ctx.logger.warn({ trackingId }, "Ignoring previous webhook secret that no longer decrypts");
		} else {
			previousSecrets.push(previous);
		}
	}

	const match = await verifyGitHubSignature(secret, rawBody, signature, previousSecrets);
	if (!match) {
		ctx.logger.warn({ trackingId, deliveryId }, "Invalid webhook signature");
		return reply.code(401).send({ error: "Invalid signature" });
	}

	if (match === "primary" && tracked.encryptedPreviousSecret) {
		await repository.clearPreviousSecret(trackingId);
	}

	const isNew = await repository.tryRecordDelivery(deliveryId, trackingId);
	if (!isNew) {
		metrics.recordDuplicate();
		ctx.logger.info({ deliveryId }, "Duplicate delivery ignored");
		return reply.code(200).send({ ok: true, duplicate: true });
	}

	metrics.recordReceived();

	if (eventName === "ping") {
		ctx.logger.info({ trackingId }, "GitHub ping received");
		return reply.code(200).send({ ok: true, ping: true });
	}

	const eventType = githubEventToType(eventName);
	if (!eventType) {
		return reply.code(200).send({ ok: true, ignored: true, reason: "unsupported_event" });
	}

	let outcome: DispatchOutcome;
	try {
		const guild = await repository.getGuildSettings(tracked.guildId);
		outcome = await dispatchEvent(
			{
				client: discord,
				repository,
				logger: ctx.logger,
				defaults: ctx.renderDefaults,
			},
			tracked,
			eventType,
			request.body,
			guild,
		);
	} catch (err) {
		await releaseClaim(ctx, deliveryId);
		throw err;
	}

	// Nothing reached Discord, so un-record the delivery: once the channel or
	// permissions are fixed, GitHub's "Redeliver" must post it rather than be
	// ignored as a duplicate of this attempt.
	if (outcome.status === "failed" || outcome.status === "bad_channel") {
		await releaseClaim(ctx, deliveryId);
	}

	switch (outcome.status) {
		case "delivered":
			ctx.logger.info(
				{
					eventType,
					deliveryId,
					repo: `${tracked.owner}/${tracked.repo}`,
				},
				"Delivered GitHub event to Discord",
			);
			return reply.code(200).send({ ok: true, delivered: true });
		case "paused":
		case "disabled":
		case "no_message":
			return reply.code(200).send({ ok: true, ignored: true, reason: outcome.status });
		case "filtered":
			return reply
				.code(200)
				.send({ ok: true, ignored: true, reason: "filtered", filter: outcome.reason });
		case "bad_channel":
			ctx.logger.warn(
				{ channelId: outcome.channelId, trackingId },
				"Target channel missing or not writable",
			);
			return reply.code(200).send({ ok: true, delivered: false, reason: "bad_channel" });
		case "failed":
			return reply.code(500).send({ error: "Delivery failed" });
	}
}

/** Best effort: failing to release only costs a later redelivery, never this response. */
async function releaseClaim(ctx: ServerContext, deliveryId: string): Promise<void> {
	try {
		await ctx.repository?.releaseDelivery(deliveryId);
	} catch (err) {
		ctx.logger.error({ err, deliveryId }, "Failed to release delivery for redelivery");
	}
}

/** Unset token keeps `/metrics` open, matching the historical default. */
function metricsTokenMatches(
	expected: string | undefined,
	authorization: string | undefined,
): boolean {
	if (!expected) return true;
	const presented = authorization?.replace(/^Bearer /i, "") ?? "";
	const a = Buffer.from(presented);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

function header(request: FastifyRequest, name: string): string | undefined {
	const value = request.headers[name];
	if (Array.isArray(value)) return value[0];
	return value;
}
