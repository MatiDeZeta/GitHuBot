import type { Client } from "discord.js";
import {
	isFullyConfigured,
	loadEnv,
	missingConfigKeys,
	type Env,
	type FullyConfiguredEnv,
} from "./config/env.js";
import { createLogger, type Logger } from "./config/logger.js";
import { applyIconOverrides } from "./bot/render/icons.js";
import { parseMasterKey } from "./crypto/secrets.js";
import { createDb, migrate, type DbHandle } from "./db/index.js";
import { createBot, registerCommands, type BotContext } from "./bot/client.js";
import { createServer, type ServerContext } from "./server/app.js";

function renderDefaultsFrom(env: Env): BotContext["renderDefaults"] {
	return {
		locale: env.DEFAULT_LOCALE,
		theme: env.DEFAULT_THEME,
		mode: env.DEFAULT_DISPLAY_MODE,
	};
}

async function main(): Promise<void> {
	const env = loadEnv();
	const logger = createLogger(env);

	const unknownIcons = applyIconOverrides(env.EMOJI_OVERRIDES);
	if (unknownIcons.length > 0) {
		logger.warn({ keys: unknownIcons }, "Ignoring unknown EMOJI_OVERRIDES keys");
	}

	const ctx: ServerContext = {
		env,
		logger,
		repository: null,
		masterKey: null,
		discord: null,
		ready: false,
		renderDefaults: renderDefaultsFrom(env),
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
		renderDefaults: renderDefaultsFrom(env),
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
