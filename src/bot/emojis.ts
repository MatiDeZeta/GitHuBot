import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type APIApplicationEmoji,
	type RESTGetAPIApplicationEmojisResult,
	Routes,
} from "discord.js";
import { APP_EMOJI_PREFIX } from "./render/icons.js";

/** `assets/emojis`, the same distance from `src/bot` and `dist/bot`. */
export const EMOJI_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../assets/emojis");

/** The slice of discord.js's REST client this needs, so tests can stand in for it. */
export interface EmojiRest {
	get(route: `/${string}`): Promise<unknown>;
	post(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
	delete(route: `/${string}`): Promise<unknown>;
}

export interface EmojiSyncResult {
	created: string[];
	replaced: string[];
	unchanged: number;
	failed: { name: string; error: string }[];
	/** The application's emojis after the sync, for `applyApplicationEmojis`. */
	emojis: APIApplicationEmoji[];
}

export async function listApplicationEmojis(
	rest: EmojiRest,
	applicationId: string,
): Promise<APIApplicationEmoji[]> {
	const result = (await rest.get(
		Routes.applicationEmojis(applicationId),
	)) as RESTGetAPIApplicationEmojisResult;
	return result.items ?? [];
}

/**
 * Uploads the bundled `gh_*.png` icons as the bot's application emojis. Emojis that
 * already exist are left alone unless `replace` is set (after re-rendering the art),
 * and emojis not named `gh_*` are never touched. Application emojis belong to the
 * bot itself, so they work in every server without taking a server's emoji slots.
 */
export async function syncApplicationEmojis(
	rest: EmojiRest,
	applicationId: string,
	options: { replace?: boolean; dir?: string } = {},
): Promise<EmojiSyncResult> {
	const dir = options.dir ?? EMOJI_DIR;
	const files = readdirSync(dir)
		.filter((file) => file.startsWith(APP_EMOJI_PREFIX) && file.endsWith(".png"))
		.sort();

	const byName = new Map(
		(await listApplicationEmojis(rest, applicationId)).map((emoji) => [emoji.name, emoji]),
	);
	const result: EmojiSyncResult = {
		created: [],
		replaced: [],
		unchanged: 0,
		failed: [],
		emojis: [],
	};

	for (const file of files) {
		const name = file.slice(0, -".png".length);
		const current = byName.get(name);
		if (current && !options.replace) {
			result.unchanged += 1;
			continue;
		}
		try {
			if (current) await rest.delete(Routes.applicationEmoji(applicationId, current.id));
			const image = `data:image/png;base64,${readFileSync(join(dir, file)).toString("base64")}`;
			const created = (await rest.post(Routes.applicationEmojis(applicationId), {
				body: { name, image },
			})) as APIApplicationEmoji;
			byName.set(name, created);
			(current ? result.replaced : result.created).push(name);
		} catch (err) {
			result.failed.push({ name, error: err instanceof Error ? err.message : String(err) });
		}
	}

	result.emojis = [...byName.values()];
	return result;
}
