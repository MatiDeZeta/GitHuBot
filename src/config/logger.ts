import pino from "pino";
import type { Env } from "./env.js";

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">) {
	const isDev = env.NODE_ENV === "development";
	return pino({
		level: env.LOG_LEVEL,
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
