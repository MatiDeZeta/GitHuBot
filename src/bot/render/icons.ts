import { ICON_KEYS, type IconKey } from "../../design/tokens.js";

/**
 * Unicode defaults. Operators can swap any of these for custom application
 * emojis (`<:name:id>`) through the `EMOJI_OVERRIDES` env var without a code
 * change — see `applyIconOverrides`.
 */
const DEFAULT_ICONS: Record<IconKey, string> = {
	push: "⬆️",
	commit: "🔨",
	branch: "🌿",
	tagRef: "🏷️",
	trash: "🗑️",
	pullRequest: "🔀",
	pullRequestDraft: "📝",
	merged: "✅",
	closed: "🚫",
	review: "🔍",
	approved: "👍",
	changesRequested: "✋",
	comment: "💬",
	issue: "🐛",
	issueClosed: "☑️",
	label: "🏷️",
	milestone: "🎯",
	release: "🚀",
	packageIcon: "📦",
	workflow: "⚙️",
	success: "✅",
	failure: "❌",
	cancelled: "⏹️",
	running: "🟡",
	deployment: "📤",
	rocket: "🚀",
	shield: "🛡️",
	alert: "🚨",
	severityCritical: "🔴",
	severityHigh: "🟠",
	severityMedium: "🟡",
	severityLow: "⚪",
	discussion: "🗣️",
	answered: "✔️",
	fork: "🍴",
	star: "⭐",
	sponsor: "💖",
	person: "👤",
	wiki: "📖",
	project: "📋",
	repo: "📁",
	key: "🔑",
	globe: "🌐",
	gear: "⚙️",
	clock: "🕐",
	github: "🐙",
};

const icons: Record<IconKey, string> = { ...DEFAULT_ICONS };
/** Keys set through EMOJI_OVERRIDES, which always win over detected app emojis. */
const explicit = new Set<IconKey>();
const KNOWN = new Set<string>(ICON_KEYS);

/** Application emojis named `gh_<iconKey>` replace that icon automatically. */
export const APP_EMOJI_PREFIX = "gh_";

export function icon(key: IconKey): string {
	return icons[key];
}

export function resetIconOverrides(): void {
	Object.assign(icons, DEFAULT_ICONS);
	explicit.clear();
}

/**
 * Applies a `{ iconKey: "<:name:id>" }` map. Unknown keys are ignored so a
 * stale override never crashes startup.
 */
export function applyIconOverrides(overrides: Record<string, string> | undefined): string[] {
	if (!overrides) return [];
	const unknown: string[] = [];
	for (const [key, value] of Object.entries(overrides)) {
		if (!KNOWN.has(key)) {
			unknown.push(key);
			continue;
		}
		if (typeof value === "string" && value.trim()) {
			icons[key as IconKey] = value.trim();
			explicit.add(key as IconKey);
		}
	}
	return unknown;
}

/**
 * Uses the bot's own application emojis named `gh_<iconKey>` (see `pnpm
 * emojis:sync`) in place of the Unicode defaults. Keys set explicitly through
 * EMOJI_OVERRIDES are left alone. Returns the keys that switched.
 */
export function applyApplicationEmojis(
	emojis: Iterable<{ id: string; name: string | null; animated?: boolean | null }>,
): IconKey[] {
	const applied: IconKey[] = [];
	for (const emoji of emojis) {
		if (!emoji.name?.startsWith(APP_EMOJI_PREFIX)) continue;
		const key = emoji.name.slice(APP_EMOJI_PREFIX.length);
		if (!KNOWN.has(key) || explicit.has(key as IconKey)) continue;
		icons[key as IconKey] = `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
		applied.push(key as IconKey);
	}
	return applied;
}
