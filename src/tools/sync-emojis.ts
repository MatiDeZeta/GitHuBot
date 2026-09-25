/**
 * Uploads GitHuBot's GitHub-style icons as the bot's application emojis:
 *
 *   pnpm emojis:sync              # local checkout (reads .env)
 *   node dist/tools/sync-emojis.js  # inside the Docker image
 *
 * Add `--replace` to re-upload icons that already exist, after re-rendering them.
 * Restart the bot afterwards; it picks up `gh_*` emojis on start.
 */
import { REST } from "discord.js";
import { syncApplicationEmojis } from "../bot/emojis.js";
import { loadEnv } from "../config/env.js";

const env = loadEnv();
if (!env.DISCORD_TOKEN || !env.DISCORD_CLIENT_ID) {
	console.error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set.");
	process.exit(1);
}

const rest = new REST().setToken(env.DISCORD_TOKEN);
const result = await syncApplicationEmojis(rest, env.DISCORD_CLIENT_ID, {
	replace: process.argv.includes("--replace"),
});

console.log(
	`Created ${result.created.length}, replaced ${result.replaced.length}, already present ${result.unchanged}.`,
);
for (const failure of result.failed) console.error(`  ✗ ${failure.name}: ${failure.error}`);
if (result.created.length + result.replaced.length > 0) {
	console.log("Restart GitHuBot to start using them.");
}
process.exit(result.failed.length > 0 ? 1 : 0);
