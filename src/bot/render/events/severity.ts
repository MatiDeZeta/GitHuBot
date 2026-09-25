import type { AccentKey, IconKey } from "../../../design/tokens.js";
import { type I18nText, tx } from "../../../i18n/index.js";
import { icon } from "../icons.js";
import { code, stateText } from "./common.js";

export type Severity = "critical" | "high" | "medium" | "low";

/**
 * GitHub spells severity differently per product: advisories say `moderate`, and
 * code scanning rules that are not security rules use `error`/`warning`/`note`.
 */
export function normalizeSeverity(value: string | null | undefined): Severity | undefined {
	switch (value?.toLowerCase()) {
		case "critical":
			return "critical";
		case "high":
		case "error":
			return "high";
		case "medium":
		case "moderate":
		case "warning":
			return "medium";
		case "low":
		case "note":
			return "low";
		default:
			return undefined;
	}
}

const ACCENTS: Record<Severity, AccentKey> = {
	critical: "securityCritical",
	high: "securityHigh",
	medium: "securityMedium",
	low: "securityLow",
};

const ICONS: Record<Severity, IconKey> = {
	critical: "severityCritical",
	high: "severityHigh",
	medium: "severityMedium",
	low: "severityLow",
};

/** Unknown severity reads as a generic security event rather than as harmless. */
export function severityAccent(severity: Severity | undefined): AccentKey {
	return severity ? ACCENTS[severity] : "security";
}

/** `🔴 **critical**`; the dot follows EMOJI_OVERRIDES like every other icon. */
export function severityBadge(severity: Severity): I18nText {
	return tx("fmt.severity", { icon: icon(ICONS[severity]), level: stateText(severity) });
}

/** `CVSS 9.8`, preferring v4 over v3 over the legacy single score. */
export function cvssBadge(...scores: (number | null | undefined)[]): I18nText | undefined {
	const score = scores.find((value): value is number => typeof value === "number" && value > 0);
	return score === undefined ? undefined : `CVSS ${score.toFixed(1)}`;
}

/**
 * EPSS — the estimated chance the vulnerability is exploited in the next 30 days.
 * GitHub has sent it both as an object and as a one-element list, as a 0–1 fraction.
 */
export function epssBadge(raw: unknown): I18nText | undefined {
	const entry = Array.isArray(raw) ? raw[0] : raw;
	const value =
		entry && typeof entry === "object" ? (entry as { percentage?: unknown }).percentage : undefined;
	const fraction = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) return undefined;
	const percent = fraction * 100;
	return `EPSS ${percent < 1 ? percent.toFixed(2) : percent.toFixed(1)}%`;
}

const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/i;
const CVE = /^CVE-\d{4}-\d{4,}$/i;

/**
 * `GHSA-… · CVE-…` as links. The ids are validated before use and the URLs are
 * built here, so the link text always matches where it goes.
 */
export function advisoryIds(
	ghsa: string | null | undefined,
	cve: string | null | undefined,
): string | undefined {
	const parts: string[] = [];
	if (ghsa && GHSA.test(ghsa)) {
		parts.push(`[${ghsa}](https://github.com/advisories/${ghsa})`);
	}
	if (cve && CVE.test(cve)) {
		parts.push(`[${cve}](https://nvd.nist.gov/vuln/detail/${cve})`);
	}
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** "upgrade to `4.17.21`", or a clear statement that no fix exists yet. */
export function fixText(patched: string | null | undefined): I18nText {
	return patched ? tx("value.fixUpgrade", { version: code(patched) }) : tx("value.noFix");
}
