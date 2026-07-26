import type {
	BranchProtectionRulePayload,
	CodeScanningAlertPayload,
	DependabotAlertPayload,
	SecretScanningAlertPayload,
	SecurityAdvisoryPayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { AccentKey } from "../../../design/tokens.js";
import type { EventTemplate, TemplateField } from "../template.js";
import {
	actorBits,
	code,
	humanizeState,
	links,
	repoBits,
	repositoryLink,
	titleText,
} from "./common.js";

function severityAccent(severity: string | null | undefined): AccentKey {
	switch (severity?.toLowerCase()) {
		case "critical":
			return "securityCritical";
		case "high":
			return "security";
		case "medium":
		case "moderate":
			return "security";
		default:
			return "neutral";
	}
}

export function formatDependabotAlert(payload: DependabotAlertPayload): EventTemplate | null {
	const alert = payload.alert;
	const advisory = alert.security_advisory;
	const bits = repoBits(payload.repository);

	let title: ReturnType<typeof tx>;
	let accent = severityAccent(advisory?.severity);

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

	const fields: TemplateField[] = [];
	if (advisory?.severity) {
		fields.push({ label: tx("field.severity"), value: code(humanizeState(advisory.severity)) });
	}
	const pkg = alert.dependency?.package;
	if (pkg?.name) {
		const ecosystem = pkg.ecosystem ? ` (${pkg.ecosystem})` : "";
		fields.push({ label: tx("field.package"), value: code(`${pkg.name}${ecosystem}`) });
	}
	if (alert.dependency?.manifest_path) {
		fields.push({
			label: tx("field.manifest"),
			value: code(alert.dependency.manifest_path),
			secondary: true,
		});
	}
	if (advisory?.cve_id) {
		fields.push({ label: tx("field.cve"), value: code(advisory.cve_id), secondary: true });
	}

	return {
		accent,
		icon: "shield",
		title,
		subtitle: advisory?.summary ? titleText(advisory.summary, 180) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links(
			{ label: tx("link.alert"), url: alert.html_url },
			{ label: tx("link.repository"), url: `${bits.repoUrl}/security/dependabot` },
		),
		timestamp: new Date(),
		importance: accent === "securityCritical" ? "high" : "normal",
	};
}

export function formatCodeScanningAlert(
	payload: CodeScanningAlertPayload,
): EventTemplate | null {
	const alert = payload.alert;
	const rule = alert.rule;

	let title: ReturnType<typeof tx>;
	let accent = severityAccent(rule?.security_severity_level ?? rule?.severity);

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
	const fields: TemplateField[] = [];
	if (rule?.id) fields.push({ label: tx("field.rule"), value: code(rule.id) });
	const severity = rule?.security_severity_level ?? rule?.severity;
	if (severity) {
		fields.push({ label: tx("field.severity"), value: code(humanizeState(severity)) });
	}
	const path = alert.most_recent_instance?.location?.path;
	if (path) fields.push({ label: tx("field.path"), value: code(path), secondary: true });
	if (payload.ref) {
		fields.push({ label: tx("field.ref"), value: code(payload.ref), secondary: true });
	}

	return {
		accent,
		icon: "alert",
		title,
		subtitle: rule?.description ? titleText(rule.description, 180) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links(
			{ label: tx("link.alert"), url: alert.html_url },
			{ label: tx("link.repository"), url: `${bits.repoUrl}/security/code-scanning` },
		),
		timestamp: new Date(),
		importance: accent === "securityCritical" ? "high" : "normal",
	};
}

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

	const bits = repoBits(payload.repository);
	const fields: TemplateField[] = [];
	const type = alert.secret_type_display_name ?? alert.secret_type;
	if (type) fields.push({ label: tx("field.secretType"), value: code(type) });
	if (alert.resolution) {
		fields.push({
			label: tx("field.resolution"),
			value: code(humanizeState(alert.resolution)),
			secondary: true,
		});
	}

	return {
		accent,
		icon: "key",
		title,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links(
			{ label: tx("link.alert"), url: alert.html_url },
			{ label: tx("link.repository"), url: `${bits.repoUrl}/security/secret-scanning` },
		),
		timestamp: new Date(),
		importance: payload.action === "created" ? "high" : "normal",
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

export function formatSecurityAdvisory(
	payload: SecurityAdvisoryPayload,
): EventTemplate | null {
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
	const fields: TemplateField[] = [];
	if (advisory.severity) {
		fields.push({ label: tx("field.severity"), value: code(humanizeState(advisory.severity)) });
	}
	if (advisory.ghsa_id) fields.push({ label: tx("field.advisory"), value: code(advisory.ghsa_id) });
	if (advisory.cve_id) {
		fields.push({ label: tx("field.cve"), value: code(advisory.cve_id), secondary: true });
	}

	return {
		accent: severityAccent(advisory.severity),
		icon: "alert",
		title,
		subtitle: advisory.summary ? titleText(advisory.summary, 180) : undefined,
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
		title: tx("title.branchProtectionConfig", { action: humanizeState(payload.action) }),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links({ label: tx("link.settings"), url: `${bits.repoUrl}/settings/branches` }),
		timestamp: new Date(),
		importance: "normal",
	};
}
