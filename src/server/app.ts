import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
	ChannelType,
	Client,
	type NewsChannel,
	type TextChannel,
} from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { formatGitHubEvent } from "../bot/components/index.js";
import { githubEventToType } from "../config/events.js";
import { isFullyConfigured, missingConfigKeys, type Env } from "../config/env.js";
import type { Logger } from "../config/logger.js";
import { decryptSecret } from "../crypto/secrets.js";
import type { RepoRepository } from "../db/types.js";
import { verifyGitHubSignature } from "../github/verify.js";

export interface ServerContext {
	env: Env;
	logger: Logger;
	repository: RepoRepository | null;
	masterKey: Buffer | null;
	discord: Client | null;
	ready: boolean;
}

declare module "fastify" {
	interface FastifyRequest {
		rawBody?: string;
	}
}

export async function createServer(ctx: ServerContext): Promise<FastifyInstance> {
	const app = Fastify({
		logger: false,
		bodyLimit: 1_048_576,
	});

	app.addContentTypeParser(
		"application/json",
		{ parseAs: "string" },
		(req, body, done) => {
			const raw = typeof body === "string" ? body : body.toString("utf8");
			req.rawBody = raw;
			try {
				const json = raw.length > 0 ? JSON.parse(raw) : {};
				done(null, json);
			} catch (err) {
				done(err as Error, undefined);
			}
		},
	);

	await app.register(rateLimit, {
		max: 100,
		timeWindow: "1 minute",
		hook: "preHandler",
	});

	app.get("/health", async () => ({
		ok: true,
		service: "githubot",
		configured: isFullyConfigured(ctx.env) && ctx.ready,
		missing: missingConfigKeys(ctx.env),
	}));

	app.post<{ Params: { trackingId: string } }>(
		"/webhooks/github/:trackingId",
		{
			config: {
				rateLimit: {
					max: 60,
					timeWindow: "1 minute",
				},
			},
		},
		async (request, reply) => handleWebhook(request, reply, ctx),
	);

	return app;
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

	let secret: string;
	const previousSecrets: string[] = [];
	try {
		secret = decryptSecret(tracked.encryptedSecret, masterKey);
		if (tracked.encryptedPreviousSecret) {
			previousSecrets.push(decryptSecret(tracked.encryptedPreviousSecret, masterKey));
		}
	} catch (err) {
		ctx.logger.error({ err, trackingId }, "Failed to decrypt webhook secret");
		return reply.code(500).send({ error: "Server configuration error" });
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
		ctx.logger.info({ deliveryId }, "Duplicate delivery ignored");
		return reply.code(200).send({ ok: true, duplicate: true });
	}

	if (eventName === "ping") {
		ctx.logger.info({ trackingId }, "GitHub ping received");
		return reply.code(200).send({ ok: true, ping: true });
	}

	const eventType = githubEventToType(eventName);
	if (!eventType) {
		return reply.code(200).send({ ok: true, ignored: true, reason: "unsupported_event" });
	}

	if (!tracked.enabledEvents.includes(eventType)) {
		return reply.code(200).send({ ok: true, ignored: true, reason: "disabled" });
	}

	const formatted = formatGitHubEvent(eventType, request.body);
	if (!formatted) {
		return reply.code(200).send({ ok: true, ignored: true, reason: "no_message" });
	}

	try {
		const channel = await discord.channels.fetch(tracked.channelId);
		if (
			!channel ||
			(channel.type !== ChannelType.GuildText &&
				channel.type !== ChannelType.GuildAnnouncement)
		) {
			ctx.logger.warn(
				{ channelId: tracked.channelId, trackingId },
				"Target channel missing or not text-based",
			);
			return reply.code(200).send({ ok: true, delivered: false, reason: "bad_channel" });
		}

		const textChannel = channel as TextChannel | NewsChannel;
		await textChannel.send({
			components: formatted.components,
			flags: formatted.flags,
		});

		ctx.logger.info(
			{
				eventType,
				deliveryId,
				repo: `${tracked.owner}/${tracked.repo}`,
				channelId: tracked.channelId,
			},
			"Delivered GitHub event to Discord",
		);
		return reply.code(200).send({ ok: true, delivered: true });
	} catch (err) {
		ctx.logger.error({ err, deliveryId, eventType }, "Failed to deliver to Discord");
		return reply.code(500).send({ error: "Delivery failed" });
	}
}

function header(request: FastifyRequest, name: string): string | undefined {
	const value = request.headers[name];
	if (Array.isArray(value)) return value[0];
	return value;
}
