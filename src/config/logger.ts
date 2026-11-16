import pino from "pino";
import type { Env } from "./env.js";

/**
 * discord.js attaches the request it was making to every API error, and for a
 * failed delivery that request is the whole rendered message: issue text, commit
 * messages, names. Logging the error as it is would copy all of that into the
 * logs, which the privacy notes promise hold ids and error messages only.
 */
export function serializeError(err: unknown): unknown {
	const serialized = pino.stdSerializers.err(err as Error) as unknown;
	if (serialized && typeof serialized === "object") {
		delete (serialized as Record<string, unknown>).requestBody;
	}
	return serialized;
}

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">) {
	const isDev = env.NODE_ENV === "development";
	return pino({
		level: env.LOG_LEVEL,
		serializers: { err: serializeError },
		redact: {
			paths: [
				"secret",
				"*.secret",
				"encryptedSecret",
				"*.encryptedSecret",
				"encryptedPreviousSecret",
				"*.encryptedPreviousSecret",
				"MASTER_KEY",
				"*.MASTER_KEY",
				"DISCORD_TOKEN",
				"*.DISCORD_TOKEN",
				"METRICS_TOKEN",
				"*.METRICS_TOKEN",
				"DISCORD_CLIENT_SECRET",
				"*.DISCORD_CLIENT_SECRET",
				"csrfToken",
				"*.csrfToken",
				"req.headers.cookie",
				'req.headers["x-hub-signature-256"]',
				"req.headers.authorization",
			],
			censor: "[redacted]",
		},
		transport: isDev
			? {
					target: "pino-pretty",
					options: {
						colorize: true,
						translateTime: "SYS:standard",
						ignore: "pid,hostname",
					},
				}
			: undefined,
	});
}

export type Logger = ReturnType<typeof createLogger>;
