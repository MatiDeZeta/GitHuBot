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

export function icon(key: IconKey): string {
	return icons[key];
}

export function resetIconOverrides(): void {
	Object.assign(icons, DEFAULT_ICONS);
}

/**
 * Applies a `{ iconKey: "<:name:id>" }` map. Unknown keys are ignored so a
 * stale override never crashes startup.
 */
export function applyIconOverrides(overrides: Record<string, string> | undefined): string[] {
	if (!overrides) return [];
	const unknown: string[] = [];
	const known = new Set<string>(ICON_KEYS);
	for (const [key, value] of Object.entries(overrides)) {
		if (!known.has(key)) {
			unknown.push(key);
			continue;
		}
		if (typeof value === "string" && value.trim()) {
			icons[key as IconKey] = value.trim();
		}
	}
	return unknown;
}
