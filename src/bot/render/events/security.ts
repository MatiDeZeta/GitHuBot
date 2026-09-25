import type { AccentKey } from "../../../design/tokens.js";
import type {
	BranchProtectionRulePayload,
	CodeScanningAlertPayload,
	DependabotAlertPayload,
	RepositoryAdvisoryPayload,
	RepositoryRulesetPayload,
	SecretScanningAlertPayload,
	SecurityAdvisoryPayload,
	SecurityAndAnalysisPayload,
} from "../../../github/payloads.js";
import { type I18nText, tx } from "../../../i18n/index.js";
import type { EventTemplate, TemplateField } from "../template.js";
import {
	actorBits,
	code,
	codeText,
	links,
	quote,
	repoBits,
	repositoryLink,
	stateText,
	titleText,
} from "./common.js";
import {
	advisoryIds,
	cvssBadge,
	epssBadge,
	fixText,
	normalizeSeverity,
	severityAccent,
	severityBadge,
} from "./severity.js";

export function formatDependabotAlert(payload: DependabotAlertPayload): EventTemplate | null {
	const alert = payload.alert;
	const advisory = alert.security_advisory;
	const vulnerability = alert.security_vulnerability;
	const bits = repoBits(payload.repository);
	const severity = normalizeSeverity(vulnerability?.severity ?? advisory?.severity);

	let title: ReturnType<typeof tx>;
	let accent = severityAccent(severity);

	switch (payload.action) {
		case "created":
		case "reintroduced":
			title = tx("title.dependabot.created");
			break;
		case "fixed":
			title = tx("title.dependabot.fixed");
			accent = "securityResolved";
			break;
		case "dismissed":
			title = tx("title.dependabot.dismissed");
			accent = "neutral";
			break;
		case "reopened":
			title = tx("title.dependabot.reopened");
			break;
		default:
			return null;
	}

	const open = accent !== "securityResolved" && accent !== "neutral";
	const cvss = advisory?.cvss_severities;
	const badge = compact(
		severity ? severityBadge(severity) : undefined,
		cvssBadge(cvss?.cvss_v4?.score, cvss?.cvss_v3?.score, advisory?.cvss?.score),
		open ? epssBadge(advisory?.epss) : undefined,
	);

	const fields: TemplateField[] = [];
	const pkg = vulnerability?.package ?? alert.dependency?.package;
	if (pkg?.name) {
		const ecosystem = pkg.ecosystem ? ` (${titleText(pkg.ecosystem, 30)})` : "";
		const manifest = alert.dependency?.manifest_path
			? ` · ${code(alert.dependency.manifest_path)}`
			: "";
		fields.push({ label: tx("field.package"), value: `${code(pkg.name)}${ecosystem}${manifest}` });
	}
	if (vulnerability?.vulnerable_version_range) {
		fields.push({
			label: tx("field.affected"),
			value: code(vulnerability.vulnerable_version_range),
		});
	}
	if (open) {
		fields.push({
			label: tx("field.fix"),
			value: fixText(vulnerability?.first_patched_version?.identifier),
		});
	}
	const ids = advisoryIds(advisory?.ghsa_id, advisory?.cve_id);
	if (ids) fields.push({ label: tx("field.ids"), value: ids, secondary: true });
	if (payload.action === "dismissed" && alert.dismissed_reason) {
		fields.push({
			label: tx("field.dismissedReason"),
			value: codeText(stateText(alert.dismissed_reason)),
		});
	}

	return {
		accent,
		icon: "shield",
		title,
		subtitle: alertSubtitle(alert.number, advisory?.summary),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		badge,
		body: payload.action === "dismissed" ? quote(alert.dismissed_comment, 300) : undefined,
		fields,
		links: links(
			{ label: tx("link.alert"), url: alert.html_url },
			{
				label: tx("link.advisory"),
				url: advisory?.ghsa_id ? `https://github.com/advisories/${advisory.ghsa_id}` : undefined,
			},
			{ label: tx("link.allAlerts"), url: `${bits.repoUrl}/security/dependabot` },
		),
		timestamp: new Date(),
		importance: severity === "critical" && open ? "high" : "normal",
	};
}

/** `#42 · Prototype pollution in lodash`, or whichever half exists. */
function alertSubtitle(number: number | undefined, summary: string | undefined) {
	const text = summary ? titleText(summary, 180) : undefined;
	if (number !== undefined && text) return `#${number} · ${text}`;
	return text ?? (number !== undefined ? `#${number}` : undefined);
}

/** Drops the parts a payload did not have, so a badge never shows an empty slot. */
function compact(...parts: (I18nText | undefined)[]): I18nText[] | undefined {
	const kept = parts.filter((part): part is I18nText => part !== undefined);
	return kept.length > 0 ? kept : undefined;
}

export function formatCodeScanningAlert(payload: CodeScanningAlertPayload): EventTemplate | null {
	const alert = payload.alert;
	const rule = alert.rule;
	// Security rules carry `security_severity_level`; quality rules only error/warning/note.
	const severity = normalizeSeverity(rule?.security_severity_level ?? rule?.severity);

	let title: ReturnType<typeof tx>;
	let accent = severityAccent(severity);

	switch (payload.action) {
		case "created":
		case "appeared_in_branch":
		case "reopened_by_user":
			title = tx("title.codeScanning.created");
			break;
		case "fixed":
			title = tx("title.codeScanning.fixed");
			accent = "securityResolved";
			break;
		case "closed_by_user":
			title = tx("title.codeScanning.closed");
			accent = "neutral";
			break;
		case "reopened":
			title = tx("title.codeScanning.reopened");
			break;
		default:
			return null;
	}

	const bits = repoBits(payload.repository);
	const instance = alert.most_recent_instance;
	const location = instance?.location;
	const fileUrl =
		location?.path && instance?.commit_sha
			? `${bits.repoUrl}/blob/${instance.commit_sha}/${location.path
					.split("/")
					.map(encodeURIComponent)
					.join("/")}${location.start_line ? `#L${location.start_line}` : ""}`
			: undefined;

	const fields: TemplateField[] = [];
	if (rule?.id) {
		const tool = alert.tool?.name ? ` · ${titleText(alert.tool.name, 40)}` : "";
		fields.push({ label: tx("field.rule"), value: `${code(rule.id)}${tool}` });
	}
	if (location?.path) {
		const line = location.start_line ? `:${location.start_line}` : "";
		fields.push({ label: tx("field.location"), value: code(`${location.path}${line}`) });
	}
	if (payload.ref) {
		fields.push({ label: tx("field.ref"), value: code(payload.ref), secondary: true });
	}

	return {
		accent,
		icon: "alert",
		title,
		subtitle: alertSubtitle(alert.number, rule?.description ?? rule?.name),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		badge: compact(severity ? severityBadge(severity) : undefined),
		// The finding's own message says what is wrong at this location.
		body: quote(instance?.message?.text, 400),
		fields,
		links: links(
			{ label: tx("link.alert"), url: alert.html_url },
			{ label: tx("link.location"), url: fileUrl },
			{ label: tx("link.allAlerts"), url: `${bits.repoUrl}/security/code-scanning` },
		),
		timestamp: new Date(),
		importance: severity === "critical" ? "high" : "normal",
	};
}

/**
 * The leaked credential itself is never read — the schema does not even model it —
 * so it cannot reach a channel no matter how the payload changes.
 */
export function formatSecretScanningAlert(
	payload: SecretScanningAlertPayload,
): EventTemplate | null {
	const alert = payload.alert;
	let title: ReturnType<typeof tx>;
	let accent: AccentKey = "securityCritical";

	switch (payload.action) {
		case "created":
			title = tx("title.secretScanning.created");
			break;
		case "resolved":
			title = tx("title.secretScanning.resolved");
			accent = "securityResolved";
			break;
		case "reopened":
			title = tx("title.secretScanning.reopened");
			break;
		default:
			return null;
	}

	const open = payload.action !== "resolved";
	const bits = repoBits(payload.repository);
	const type = alert.secret_type_display_name ?? alert.secret_type;

	// Validity decides urgency: an `active` secret still works right now.
	const badge = compact(
		open && alert.validity === "active" ? tx("value.secretStillValid") : undefined,
		open && alert.publicly_leaked ? tx("value.publiclyLeaked") : undefined,
		open && alert.multi_repo ? tx("value.multiRepo") : undefined,
	);

	const fields: TemplateField[] = [];
	if (type) fields.push({ label: tx("field.secretType"), value: code(titleText(type, 80)) });
	if (alert.validity && alert.validity !== "active") {
		fields.push({ label: tx("field.validity"), value: codeText(stateText(alert.validity)) });
	}
	if (alert.push_protection_bypassed && alert.push_protection_bypassed_by?.login) {
		fields.push({
			label: tx("field.state"),
			value: tx("value.pushProtectionBypassed", {
				user: titleText(alert.push_protection_bypassed_by.login, 40),
			}),
		});
	}
	if (alert.resolution) {
		fields.push({ label: tx("field.resolution"), value: codeText(stateText(alert.resolution)) });
	}

	return {
		accent,
		icon: "key",
		title,
		subtitle: alertSubtitle(alert.number, undefined),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		badge,
		body: open ? undefined : quote(alert.resolution_comment, 300),
		fields,
		links: links(
			{ label: tx("link.alert"), url: alert.html_url },
			{ label: tx("link.allAlerts"), url: `${bits.repoUrl}/security/secret-scanning` },
		),
		timestamp: new Date(),
		importance: open ? "high" : "normal",
	};
}

/** A new location for an already-reported secret: same alert, extra context. */
export function formatSecretScanningAlertLocation(
	payload: SecretScanningAlertPayload,
): EventTemplate | null {
	if (payload.action !== "created") return null;
	const bits = repoBits(payload.repository);
	const type = payload.alert.secret_type_display_name ?? payload.alert.secret_type;

	return {
		accent: "securityCritical",
		icon: "key",
		title: tx("title.secretScanningLocation"),
		subtitle: type ? code(type) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields: payload.location?.type
			? [{ label: tx("field.state"), value: code(payload.location.type) }]
			: undefined,
		links: links({ label: tx("link.alert"), url: payload.alert.html_url }),
		timestamp: new Date(),
		importance: "high",
	};
}

export function formatSecurityAdvisory(payload: SecurityAdvisoryPayload): EventTemplate | null {
	const advisory = payload.security_advisory;
	const title =
		payload.action === "published"
			? tx("title.advisory.published")
			: payload.action === "updated"
				? tx("title.advisory.updated")
				: payload.action === "withdrawn"
					? tx("title.advisory.withdrawn")
					: null;
	if (!title) return null;

	const bits = repoBits(payload.repository);
	const severity = normalizeSeverity(advisory.severity);
	const fields: TemplateField[] = [];
	const ids = advisoryIds(advisory.ghsa_id, advisory.cve_id);
	if (ids) fields.push({ label: tx("field.ids"), value: ids });

	return {
		accent: payload.action === "withdrawn" ? "neutral" : severityAccent(severity),
		icon: "alert",
		title,
		subtitle: advisory.summary ? titleText(advisory.summary, 180) : undefined,
		badge: compact(severity ? severityBadge(severity) : undefined),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links(
			{ label: tx("link.advisory"), url: advisory.references?.[0]?.url },
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance: "high",
	};
}

/** The repository-scoped advisory event; `security_advisory` only reaches GitHub Apps. */
export function formatRepositoryAdvisory(payload: RepositoryAdvisoryPayload): EventTemplate | null {
	const advisory = payload.repository_advisory;
	const title =
		payload.action === "published"
			? tx("title.repositoryAdvisory.published")
			: payload.action === "reported"
				? tx("title.repositoryAdvisory.reported")
				: null;
	if (!title) return null;

	const bits = repoBits(payload.repository);
	const severity = normalizeSeverity(advisory.severity);
	const cvss = advisory.cvss_severities;
	const fields: TemplateField[] = [];
	// One line per affected package (capped), each with its fix when one exists.
	for (const vulnerability of (advisory.vulnerabilities ?? []).slice(0, 3)) {
		const name = vulnerability.package?.name;
		if (!name) continue;
		const range = vulnerability.vulnerable_version_range
			? ` ${code(vulnerability.vulnerable_version_range)}`
			: "";
		fields.push({ label: tx("field.package"), value: `${code(name)}${range}` });
		fields.push({ label: tx("field.fix"), value: fixText(vulnerability.patched_versions) });
	}
	const ids = advisoryIds(advisory.ghsa_id, advisory.cve_id);
	if (ids) fields.push({ label: tx("field.ids"), value: ids, secondary: true });
	if (advisory.state) {
		fields.push({
			label: tx("field.state"),
			value: codeText(stateText(advisory.state)),
			secondary: true,
		});
	}

	return {
		accent: severityAccent(severity),
		icon: "alert",
		title,
		subtitle: advisory.summary ? titleText(advisory.summary, 180) : undefined,
		badge: compact(
			severity ? severityBadge(severity) : undefined,
			cvssBadge(cvss?.cvss_v4?.score, cvss?.cvss_v3?.score, advisory.cvss?.score),
		),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links(
			{ label: tx("link.advisory"), url: advisory.html_url },
			{ label: tx("link.repository"), url: `${bits.repoUrl}/security/advisories` },
		),
		timestamp: new Date(),
		importance: "high",
	};
}

export function formatRepositoryRuleset(payload: RepositoryRulesetPayload): EventTemplate | null {
	const ruleset = payload.repository_ruleset;
	const title =
		payload.action === "created"
			? tx("title.ruleset.created")
			: payload.action === "edited"
				? tx("title.ruleset.edited")
				: payload.action === "deleted"
					? tx("title.ruleset.deleted")
					: null;
	if (!title) return null;

	const bits = repoBits(payload.repository);
	const fields: TemplateField[] = [];
	if (ruleset.target) {
		fields.push({ label: tx("field.target"), value: codeText(stateText(ruleset.target)) });
	}
	if (ruleset.enforcement) {
		fields.push({
			label: tx("field.enforcement"),
			value: codeText(stateText(ruleset.enforcement)),
		});
	}
	if (ruleset.source_type) {
		fields.push({
			label: tx("field.scope"),
			value: code(ruleset.source_type),
			secondary: true,
		});
	}

	return {
		// An `evaluate`/`disabled` ruleset is not actually protecting anything yet.
		accent:
			payload.action === "deleted"
				? "delete"
				: ruleset.enforcement === "active"
					? "security"
					: "neutral",
		icon: "shield",
		title,
		subtitle: ruleset.name ? code(ruleset.name) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links({ label: tx("link.settings"), url: `${bits.repoUrl}/settings/rules` }),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatSecurityAndAnalysis(
	payload: SecurityAndAnalysisPayload,
): EventTemplate | null {
	const changed = Object.keys(payload.changes?.from?.security_and_analysis ?? {});
	const bits = repoBits(payload.repository);

	return {
		accent: "security",
		icon: "shield",
		title: tx("title.securityAndAnalysis"),
		subtitle:
			changed.length > 0
				? code(changed.map((name) => name.replace(/_/g, " ")).join(", "))
				: undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links({
			label: tx("link.settings"),
			url: `${bits.repoUrl}/settings/security_analysis`,
		}),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatBranchProtectionRule(
	payload: BranchProtectionRulePayload,
): EventTemplate | null {
	const title =
		payload.action === "created"
			? tx("title.branchProtection.created")
			: payload.action === "edited"
				? tx("title.branchProtection.edited")
				: payload.action === "deleted"
					? tx("title.branchProtection.deleted")
					: null;
	if (!title) return null;

	const bits = repoBits(payload.repository);
	return {
		accent: payload.action === "deleted" ? "delete" : "security",
		icon: "shield",
		title,
		subtitle: payload.rule?.name ? code(payload.rule.name) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links({ label: tx("link.settings"), url: `${bits.repoUrl}/settings/branches` }),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatBranchProtectionConfiguration(
	payload: BranchProtectionRulePayload,
): EventTemplate | null {
	const bits = repoBits(payload.repository);
	return {
		accent: "security",
		icon: "shield",
		title: tx("title.branchProtectionConfig", { action: stateText(payload.action) }),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links({ label: tx("link.settings"), url: `${bits.repoUrl}/settings/branches` }),
		timestamp: new Date(),
		importance: "normal",
	};
}
