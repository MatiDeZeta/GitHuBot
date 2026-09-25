#!/usr/bin/env node
/**
 * Draws GitHub's Octicons as coloured 128×128 PNGs in assets/emojis/, one per icon
 * key, named `gh_<iconKey>.png`. `pnpm emojis:sync` uploads them as the bot's
 * application emojis, and the bot uses any it finds in place of Unicode.
 *
 * Run with `pnpm emojis:render` after changing the map below or bumping
 * @primer/octicons. The PNGs are committed, so production never needs these
 * dev dependencies.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const require = createRequire(import.meta.url);
const octicons = require("@primer/octicons/build/data.json");
const OUT = "assets/emojis";

// GitHub's dark-theme state colours; they also read on Discord's light theme.
const GREEN = "#3fb950";
const PURPLE = "#a371f7";
const RED = "#f85149";
const BLUE = "#58a6ff";
const YELLOW = "#d29922";
const ORANGE = "#db6d28";
const PINK = "#db61a2";
const GREY = "#8b949e";

/**
 * Icon key → [octicon, colour]. `github` is deliberately absent: the GitHub mark is
 * a trademark with its own usage rules, so it keeps its Unicode default.
 */
const ICONS = {
	push: ["repo-push", BLUE],
	commit: ["git-commit", GREY],
	branch: ["git-branch", BLUE],
	tagRef: ["tag", BLUE],
	trash: ["trash", RED],
	pullRequest: ["git-pull-request", GREEN],
	pullRequestDraft: ["git-pull-request-draft", GREY],
	merged: ["git-merge", PURPLE],
	closed: ["git-pull-request-closed", RED],
	review: ["eye", BLUE],
	approved: ["check-circle", GREEN],
	changesRequested: ["file-diff", RED],
	comment: ["comment", GREY],
	issue: ["issue-opened", GREEN],
	issueClosed: ["issue-closed", PURPLE],
	label: ["tag", GREY],
	milestone: ["milestone", GREY],
	release: ["tag", GREEN],
	packageIcon: ["package", ORANGE],
	workflow: ["workflow", GREY],
	success: ["check-circle-fill", GREEN],
	failure: ["x-circle-fill", RED],
	cancelled: ["circle-slash", GREY],
	running: ["dot-fill", YELLOW],
	deployment: ["rocket", BLUE],
	rocket: ["rocket", PURPLE],
	shield: ["shield", ORANGE],
	alert: ["alert", ORANGE],
	severityCritical: ["dot-fill", RED],
	severityHigh: ["dot-fill", ORANGE],
	severityMedium: ["dot-fill", YELLOW],
	severityLow: ["dot-fill", GREY],
	discussion: ["comment-discussion", BLUE],
	answered: ["check-circle", GREEN],
	fork: ["repo-forked", GREY],
	star: ["star-fill", YELLOW],
	sponsor: ["heart-fill", PINK],
	person: ["person", GREY],
	wiki: ["book", GREY],
	project: ["table", GREY],
	repo: ["repo", GREY],
	key: ["key", YELLOW],
	globe: ["globe", BLUE],
	gear: ["gear", GREY],
	clock: ["clock", GREY],
};

await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
mkdirSync(OUT, { recursive: true });

for (const [key, [name, color]] of Object.entries(ICONS)) {
	const icon = octicons[name]?.heights?.["24"];
	if (!icon) throw new Error(`Octicon ${name} (for ${key}) has no 24px variant`);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><g fill="${color}">${icon.path}</g></svg>`;
	const png = new Resvg(svg, { fitTo: { mode: "width", value: 128 } }).render().asPng();
	writeFileSync(join(OUT, `gh_${key}.png`), png);
}

// Octicons are MIT licensed; the notice travels with the artwork.
const license = readFileSync(
	join(dirname(require.resolve("@primer/octicons/package.json")), "LICENSE"),
	"utf8",
);
writeFileSync(join(OUT, "LICENSE-octicons.txt"), license);
console.log(`Rendered ${Object.keys(ICONS).length} icons to ${OUT}`);
