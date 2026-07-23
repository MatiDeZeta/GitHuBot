import type { Client } from "discord.js";
import {
	isFullyConfigured,
	loadEnv,
	missingConfigKeys,
	type FullyConfiguredEnv,
} from "./config/env.js";
import { createLogger, type Logger } from "./config/logger.js";
import { parseMasterKey } from "./crypto/secrets.js";
import { createDb, migrate, type DbHandle } from "./db/index.js";
import { createBot, registerCommands } from "./bot/client.js";
import { createServer, type ServerContext } from "./server/app.js";

async function main(): Promise<void> {
	const env = loadEnv();
	const logger = createLogger(env);

	const ctx: ServerContext = {
		env,
		logger,
		repository: null,
		masterKey: null,
		discord: null,
		ready: false,
	};

	const server = await createServer(ctx);
	await server.listen({ port: env.PORT, host: env.HOST });
	logger.info({ port: env.PORT, host: env.HOST }, "HTTP server listening");

	let db: DbHandle | null = null;
	let bot: Client | null = null;

	if (!isFullyConfigured(env)) {
		logger.warn(
			{ missing: missingConfigKeys(env) },
			"Running in degraded mode — set missing env vars to enable Discord + webhooks",
		);
	} else {
		const started = await startFullStack(env, logger);
		db = started.db;
		bot = started.bot;
		ctx.repository = started.db.repository;
		ctx.masterKey = started.masterKey;
		ctx.discord = started.bot;
		ctx.ready = started.ready;
	}

	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down");
		try {
			await server.close();
			bot?.destroy();
			await db?.close();
		} finally {
			process.exit(0);
		}
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function startFullStack(
	env: FullyConfiguredEnv,
	logger: Logger,
): Promise<{ db: DbHandle; bot: Client; masterKey: Buffer; ready: boolean }> {
	const masterKey = parseMasterKey(env.MASTER_KEY);

	logger.info(
		{ dialect: env.DATABASE_URL.startsWith("postgres") ? "postgres" : "sqlite" },
		"Applying migrations",
	);
	await migrate(env.DATABASE_URL);

	const db = createDb(env.DATABASE_URL);
	const bot = createBot({
		env,
		logger,
		repository: db.repository,
		masterKey,
	});

	try {
		await bot.login(env.DISCORD_TOKEN);
		await registerCommands(bot, env, logger);
		logger.info("Discord bot fully ready");
		return { db, bot, masterKey, ready: true };
	} catch (err) {
		logger.error({ err }, "Discord login/command registration failed");
		return { db, bot, masterKey, ready: false };
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
