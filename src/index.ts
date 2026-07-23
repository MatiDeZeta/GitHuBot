import { loadEnv } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { parseMasterKey } from "./crypto/secrets.js";
import { createDb, migrate } from "./db/index.js";
import { createBot, registerCommands } from "./bot/client.js";
import { createServer } from "./server/app.js";

async function main(): Promise<void> {
	const env = loadEnv();
	const logger = createLogger(env);
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

	const server = await createServer({
		env,
		logger,
		repository: db.repository,
		masterKey,
		discord: bot,
	});

	// Bind HTTP first so Railway/Docker healthchecks succeed while Discord connects.
	await server.listen({ port: env.PORT, host: env.HOST });
	logger.info({ port: env.PORT, host: env.HOST }, "HTTP server listening");

	try {
		await bot.login(env.DISCORD_TOKEN);
		await registerCommands(bot, env, logger);
	} catch (err) {
		logger.error({ err }, "Discord login/command registration failed");
		// Keep HTTP up so healthchecks and logs remain available while you fix credentials.
	}

	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down");
		try {
			await server.close();
			bot.destroy();
			await db.close();
		} finally {
			process.exit(0);
		}
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
