import type { AccentKey } from "../../design/tokens.js";

export const THEME_IDS = ["default", "github", "neon", "mono", "language"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "default";

export function isThemeId(value: unknown): value is ThemeId {
	return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

type Palette = Record<AccentKey, number>;

const defaultPalette: Palette = {
	neutral: 0x6b7280,
	push: 0x6b7280,
	branch: 0x14b8a6,
	tagRef: 0x0d9488,
	delete: 0xf97316,
	prOpen: 0x3b82f6,
	prDraft: 0x94a3b8,
	prMerged: 0x8b5cf6,
	prClosed: 0xef4444,
	review: 0x0ea5e9,
	reviewApproved: 0x22c55e,
	reviewChanges: 0xf97316,
	comment: 0x64748b,
	issueOpen: 0xf59e0b,
	issueClosed: 0xa855f7,
	issueNotPlanned: 0x6b7280,
	label: 0x8b5cf6,
	milestone: 0x0ea5e9,
	release: 0xa855f7,
	prerelease: 0xd946ef,
	packageAccent: 0x7c3aed,
	workflowRunning: 0xf59e0b,
	workflowSuccess: 0x22c55e,
	workflowFailure: 0xef4444,
	workflowCancelled: 0x6b7280,
	deployment: 0x0ea5e9,
	deploymentSuccess: 0x22c55e,
	deploymentFailure: 0xef4444,
	security: 0xf97316,
	securityCritical: 0xdc2626,
	securityResolved: 0x22c55e,
	discussion: 0x6366f1,
	discussionAnswered: 0x22c55e,
	fork: 0x6366f1,
	star: 0xeab308,
	sponsor: 0xec4899,
	member: 0x14b8a6,
	wiki: 0x0ea5e9,
	project: 0x8b5cf6,
	repoMeta: 0x64748b,
	key: 0xf59e0b,
};

/** Muted palette that mirrors GitHub's own state colors. */
const githubPalette: Palette = {
	...defaultPalette,
	push: 0x57606a,
	branch: 0x1f883d,
	tagRef: 0x1f883d,
	delete: 0xcf222e,
	prOpen: 0x1f883d,
	prDraft: 0x6e7781,
	prMerged: 0x8250df,
	prClosed: 0xcf222e,
	reviewApproved: 0x1f883d,
	reviewChanges: 0xbc4c00,
	issueOpen: 0x1f883d,
	issueClosed: 0x8250df,
	issueNotPlanned: 0x6e7781,
	release: 0x8250df,
	workflowSuccess: 0x1f883d,
	workflowFailure: 0xcf222e,
	deploymentSuccess: 0x1f883d,
	deploymentFailure: 0xcf222e,
	security: 0xbc4c00,
	securityCritical: 0xa40e26,
	star: 0xbf8700,
	comment: 0x6e7781,
	neutral: 0x6e7781,
};

/** High-saturation palette for dark themes. */
const neonPalette: Palette = {
	...defaultPalette,
	neutral: 0x94a3b8,
	push: 0x22d3ee,
	branch: 0x2dd4bf,
	tagRef: 0x34d399,
	delete: 0xfb7185,
	prOpen: 0x60a5fa,
	prDraft: 0xa5b4fc,
	prMerged: 0xc084fc,
	prClosed: 0xfb7185,
	review: 0x38bdf8,
	reviewApproved: 0x4ade80,
	reviewChanges: 0xfbbf24,
	comment: 0x94a3b8,
	issueOpen: 0xfbbf24,
	issueClosed: 0xc084fc,
	release: 0xe879f9,
	prerelease: 0xf0abfc,
	workflowSuccess: 0x4ade80,
	workflowFailure: 0xfb7185,
	workflowRunning: 0xfbbf24,
	deploymentSuccess: 0x4ade80,
	deploymentFailure: 0xfb7185,
	security: 0xfb923c,
	securityCritical: 0xf43f5e,
	discussion: 0x818cf8,
	fork: 0x818cf8,
	star: 0xfacc15,
	sponsor: 0xf472b6,
};

const monoPalette: Palette = Object.fromEntries(
	(Object.keys(defaultPalette) as AccentKey[]).map((key) => [key, 0x9ca3af]),
) as Palette;

const PALETTES: Record<Exclude<ThemeId, "language">, Palette> = {
	default: defaultPalette,
	github: githubPalette,
	neon: neonPalette,
	mono: monoPalette,
};

/** Approximate GitHub Linguist colors for the `language` theme. */
const LANGUAGE_COLORS: Record<string, number> = {
	typescript: 0x3178c6,
	javascript: 0xf1e05a,
	python: 0x3572a5,
	rust: 0xdea584,
	go: 0x00add8,
	java: 0xb07219,
	kotlin: 0xa97bff,
	swift: 0xf05138,
	"c++": 0xf34b7d,
	c: 0x555555,
	"c#": 0x178600,
	ruby: 0x701516,
	php: 0x4f5d95,
	dart: 0x00b4ab,
	elixir: 0x6e4a7e,
	haskell: 0x5e5086,
	lua: 0x000080,
	scala: 0xc22d40,
	shell: 0x89e051,
	html: 0xe34c26,
	css: 0x563d7c,
	vue: 0x41b883,
	svelte: 0xff3e00,
	zig: 0xec915c,
};

export interface AccentContext {
	theme: ThemeId;
	language?: string | null;
}

export function resolveAccent(accent: AccentKey, ctx: AccentContext): number {
	if (ctx.theme === "language") {
		const language = ctx.language?.toLowerCase();
		const color = language ? LANGUAGE_COLORS[language] : undefined;
		return color ?? defaultPalette[accent];
	}
	return PALETTES[ctx.theme][accent];
}
