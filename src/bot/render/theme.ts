import type { AccentKey } from "../../design/tokens.js";
import { LANGUAGE_COLORS } from "./languages.generated.js";

export const THEME_IDS = [
	"default",
	"github",
	"neon",
	"catppuccin",
	"nord",
	"accessible",
	"mono",
	"language",
] as const;
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
	securityHigh: 0xea580c,
	securityMedium: 0xf59e0b,
	securityLow: 0x94a3b8,
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
	securityHigh: 0xbc4c00,
	securityMedium: 0x9a6700,
	securityLow: 0x6e7781,
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
	securityHigh: 0xfb923c,
	securityMedium: 0xfacc15,
	securityLow: 0xcbd5e1,
	discussion: 0x818cf8,
	fork: 0x818cf8,
	star: 0xfacc15,
	sponsor: 0xf472b6,
};

/**
 * The colour roles a palette is built from. Every accent maps onto one, so a new
 * theme only picks a dozen colours and still covers every event.
 */
interface Roles {
	neutral: number;
	primary: number;
	info: number;
	success: number;
	failure: number;
	critical: number;
	warning: number;
	caution: number;
	merged: number;
	special: number;
	teal: number;
	indigo: number;
}

function fromRoles(r: Roles): Palette {
	return {
		neutral: r.neutral,
		push: r.primary,
		branch: r.teal,
		tagRef: r.teal,
		delete: r.caution,
		prOpen: r.info,
		prDraft: r.neutral,
		prMerged: r.merged,
		prClosed: r.failure,
		review: r.info,
		reviewApproved: r.success,
		reviewChanges: r.caution,
		comment: r.neutral,
		issueOpen: r.warning,
		issueClosed: r.merged,
		issueNotPlanned: r.neutral,
		label: r.merged,
		milestone: r.info,
		release: r.merged,
		prerelease: r.special,
		packageAccent: r.merged,
		workflowRunning: r.warning,
		workflowSuccess: r.success,
		workflowFailure: r.failure,
		workflowCancelled: r.neutral,
		deployment: r.info,
		deploymentSuccess: r.success,
		deploymentFailure: r.failure,
		security: r.caution,
		securityCritical: r.critical,
		securityHigh: r.caution,
		securityMedium: r.warning,
		securityLow: r.neutral,
		securityResolved: r.success,
		discussion: r.indigo,
		discussionAnswered: r.success,
		fork: r.indigo,
		star: r.warning,
		sponsor: r.special,
		member: r.teal,
		wiki: r.info,
		project: r.merged,
		repoMeta: r.neutral,
		key: r.warning,
	};
}

/** Catppuccin Mocha: soft pastels made for dark themes. */
const catppuccinPalette = fromRoles({
	neutral: 0x9399b2,
	primary: 0x89b4fa,
	info: 0x74c7ec,
	success: 0xa6e3a1,
	failure: 0xf38ba8,
	critical: 0xeba0ac,
	warning: 0xf9e2af,
	caution: 0xfab387,
	merged: 0xcba6f7,
	special: 0xf5c2e7,
	teal: 0x94e2d5,
	indigo: 0xb4befe,
});

/** Nord: cool frost blues with muted aurora accents for state. */
const nordPalette = fromRoles({
	neutral: 0x7b88a1,
	primary: 0x88c0d0,
	info: 0x81a1c1,
	success: 0xa3be8c,
	failure: 0xbf616a,
	critical: 0xbf616a,
	warning: 0xebcb8b,
	caution: 0xd08770,
	merged: 0xb48ead,
	special: 0xb48ead,
	teal: 0x8fbcbb,
	indigo: 0x5e81ac,
});

/**
 * Okabe–Ito: a palette chosen to stay distinguishable with the common forms of
 * colour blindness, so success and failure never rely on red versus green alone.
 */
const accessiblePalette = fromRoles({
	neutral: 0x999999,
	primary: 0x56b4e9,
	info: 0x0072b2,
	success: 0x009e73,
	failure: 0xd55e00,
	critical: 0xd55e00,
	warning: 0xf0e442,
	caution: 0xe69f00,
	merged: 0xcc79a7,
	special: 0xcc79a7,
	teal: 0x009e73,
	indigo: 0x0072b2,
});

const monoPalette: Palette = Object.fromEntries(
	(Object.keys(defaultPalette) as AccentKey[]).map((key) => [key, 0x9ca3af]),
) as Palette;

const PALETTES: Record<Exclude<ThemeId, "language">, Palette> = {
	default: defaultPalette,
	github: githubPalette,
	neon: neonPalette,
	catppuccin: catppuccinPalette,
	nord: nordPalette,
	accessible: accessiblePalette,
	mono: monoPalette,
};

/**
 * Some Linguist colours are close to black (Lua is navy, C is dark grey) and all but
 * vanish as an accent bar on Discord's dark background. Those are lifted toward
 * white just enough to show, keeping their hue.
 */
function visible(color: number): number {
	const channel = (shift: number) => ((color >> shift) & 0xff) / 255;
	const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const luminance =
		0.2126 * linear(channel(16)) + 0.7152 * linear(channel(8)) + 0.0722 * linear(channel(0));
	if (luminance >= 0.05) return color;
	const lift = (shift: number) => {
		const value = (color >> shift) & 0xff;
		return Math.round(value + (255 - value) * 0.35) << shift;
	};
	return lift(16) | lift(8) | lift(0);
}

/**
 * Accents whose colour carries meaning — pass/fail, severity, merged/closed. The
 * `language` theme leaves these alone, so a failed build or a critical alert is still
 * red in a TypeScript repository; only informational accents take the language colour.
 */
const STATUS_ACCENTS: ReadonlySet<AccentKey> = new Set<AccentKey>([
	"delete",
	"prDraft",
	"prMerged",
	"prClosed",
	"reviewApproved",
	"reviewChanges",
	"issueClosed",
	"issueNotPlanned",
	"workflowRunning",
	"workflowSuccess",
	"workflowFailure",
	"workflowCancelled",
	"deploymentSuccess",
	"deploymentFailure",
	"security",
	"securityCritical",
	"securityHigh",
	"securityMedium",
	"securityLow",
	"securityResolved",
	"discussionAnswered",
]);

export interface AccentContext {
	theme: ThemeId;
	language?: string | null;
}

export function resolveAccent(accent: AccentKey, ctx: AccentContext): number {
	if (ctx.theme === "language") {
		const language = ctx.language?.toLowerCase();
		const color = language && !STATUS_ACCENTS.has(accent) ? LANGUAGE_COLORS[language] : undefined;
		return color === undefined ? defaultPalette[accent] : visible(color);
	}
	return PALETTES[ctx.theme][accent];
}
