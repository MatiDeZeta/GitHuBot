import { EVENT_META, type EventType } from "../../config/events.js";
import { type TranslationKey, tx } from "../../i18n/index.js";
import { buildEventTemplate } from "./events/index.js";
import type { EventTemplate } from "./template.js";

/** Accent chosen so a generic test message looks like the real thing for that event. */
const SAMPLE_ACCENTS: Partial<Record<EventType, EventTemplate["accent"]>> = {
	push: "push",
	pull_request: "prMerged",
	issues: "issueOpen",
	release: "release",
	workflow_run: "workflowSuccess",
	deployment_status: "deploymentSuccess",
	star: "star",
	fork: "fork",
	dependabot_alert: "security",
	discussion: "discussion",
};

interface SampleContext {
	/** `owner/repo` of the tracked repository. */
	repo: string;
	repoUrl: string;
	actor: { login: string; avatarUrl?: string };
}

/**
 * Plausible payloads for the events people test most, fed through the real
 * formatters so `/repo test` and the style preview show exactly what a delivery
 * will look like. Anything not listed falls back to a generic test message.
 * All text is fixed sample copy — nothing here is read from GitHub.
 */
function samplePayload(eventType: EventType, s: SampleContext): object | undefined {
	const [owner = "owner", name = "repo"] = s.repo.split("/");
	const repository = {
		full_name: s.repo,
		html_url: s.repoUrl,
		name,
		owner: { login: owner },
		pushed_at: Math.floor(Date.now() / 1000),
	};
	const sender = { login: s.actor.login, avatar_url: s.actor.avatarUrl };
	const url = (path: string) => `${s.repoUrl}/${path}`;
	const base = { repository, sender };

	switch (eventType) {
		case "push":
			return {
				...base,
				ref: "refs/heads/main",
				compare: url("compare/1a2b3c4...5d6e7f8"),
				commits: [
					["5d6e7f8", "feat: retry failed deliveries with backoff"],
					["4c5d6e7", "fix: keep thread names under 100 characters"],
					["3b4c5d6", "docs: explain the language theme"],
				].map(([id, message]) => ({
					id: `${id}000000000000000000000000000000000`,
					message,
					url: url(`commit/${id}`),
					author: { username: s.actor.login },
				})),
			};
		case "create":
			return { ...base, ref: "v2.4.0", ref_type: "tag" };
		case "pull_request":
			return {
				...base,
				action: "closed",
				number: 128,
				pull_request: {
					html_url: url("pull/128"),
					title: "Add retry with exponential backoff",
					body: "Deliveries that fail now retry three times before giving up.",
					merged: true,
					additions: 214,
					deletions: 37,
					changed_files: 6,
					commits: 4,
					labels: [{ name: "enhancement" }],
					user: sender,
					merged_by: sender,
					base: { ref: "main" },
					head: { ref: "feat/retry" },
				},
			};
		case "pull_request_review":
			return {
				...base,
				action: "submitted",
				review: {
					html_url: url("pull/128#review"),
					state: "approved",
					body: "Looks great, ship it.",
				},
				pull_request: { html_url: url("pull/128"), number: 128, title: "Add retry with backoff" },
			};
		case "issues":
			return {
				...base,
				action: "opened",
				issue: {
					html_url: url("issues/97"),
					number: 97,
					title: "Webhook deliveries time out behind a proxy",
					body: "Since upgrading, deliveries fail with a 504 when the bot runs behind nginx.",
					labels: [{ name: "bug" }, { name: "help wanted" }],
					user: sender,
				},
			};
		case "issue_comment":
			return {
				...base,
				action: "created",
				issue: { html_url: url("issues/97"), number: 97, title: "Webhook deliveries time out" },
				comment: {
					html_url: url("issues/97#issuecomment-1"),
					body: "Setting `TRUST_PROXY=true` fixed it for me.",
					user: sender,
				},
			};
		case "release":
			return {
				...base,
				action: "published",
				release: {
					html_url: url("releases/tag/v2.4.0"),
					tag_name: "v2.4.0",
					name: "v2.4.0 — Faster deliveries",
					body: "### Highlights\n- Retries with backoff\n- Smaller Docker image",
					author: sender,
					assets: [{ name: "app-linux-x64.tar.gz", download_count: 0 }],
				},
			};
		case "workflow_run":
			return {
				...base,
				action: "completed",
				workflow_run: {
					html_url: url("actions/runs/1"),
					name: "CI",
					display_title: "Add retry with exponential backoff",
					status: "completed",
					conclusion: "failure",
					event: "pull_request",
					run_number: 512,
					head_branch: "feat/retry",
					run_started_at: new Date(Date.now() - 4 * 60_000).toISOString(),
					updated_at: new Date().toISOString(),
					actor: sender,
				},
			};
		case "deployment_status":
			return {
				...base,
				action: "created",
				deployment: { environment: "production", ref: "main" },
				deployment_status: {
					state: "success",
					description: "Deployed v2.4.0",
					environment_url: "https://example.com",
					creator: sender,
				},
			};
		case "dependabot_alert":
			return {
				...base,
				action: "created",
				alert: {
					number: 12,
					html_url: url("security/dependabot/12"),
					dependency: {
						package: { name: "lodash", ecosystem: "npm" },
						manifest_path: "package.json",
					},
					security_advisory: {
						ghsa_id: "GHSA-35jh-r3h4-6jhm",
						cve_id: "CVE-2021-23337",
						summary: "Command injection in lodash",
						severity: "high",
						cvss_severities: { cvss_v3: { score: 7.2 } },
					},
					security_vulnerability: {
						severity: "high",
						vulnerable_version_range: "< 4.17.21",
						first_patched_version: { identifier: "4.17.21" },
					},
				},
			};
		case "code_scanning_alert":
			return {
				...base,
				action: "created",
				ref: "refs/heads/main",
				alert: {
					number: 4,
					html_url: url("security/code-scanning/4"),
					tool: { name: "CodeQL" },
					rule: {
						id: "js/xss",
						description: "Client-side cross-site scripting",
						security_severity_level: "high",
					},
					most_recent_instance: {
						commit_sha: "5d6e7f8",
						message: { text: "Cross-site scripting vulnerability due to user-provided value." },
						location: { path: "src/render.ts", start_line: 42 },
					},
				},
			};
		case "secret_scanning_alert":
			return {
				...base,
				action: "created",
				alert: {
					number: 2,
					html_url: url("security/secret-scanning/2"),
					secret_type_display_name: "GitHub Personal Access Token",
					validity: "active",
				},
			};
		case "discussion":
			return {
				...base,
				action: "created",
				discussion: {
					html_url: url("discussions/15"),
					number: 15,
					title: "Show us your changelog channel",
					body: "Share a screenshot of how your server uses GitHuBot.",
					category: { name: "Show and tell", emoji: "🙌" },
					user: sender,
				},
			};
		case "star":
			return { ...base, action: "created", starred_at: new Date().toISOString() };
		case "fork":
			return {
				...base,
				forkee: { full_name: `${s.actor.login}/${name}`, html_url: s.repoUrl, owner: sender },
			};
		default:
			return undefined;
	}
}

/**
 * A realistic message for `eventType`, tagged as a test so nobody mistakes it for
 * real activity. Events without a sample get a generic message instead of a fake
 * payload for each of the ~50 event types.
 */
export function sampleTemplate(
	eventType: EventType,
	repo: string,
	repoUrl: string,
	actor: { login: string; avatarUrl?: string },
): EventTemplate {
	const payload = samplePayload(eventType, { repo, repoUrl, actor });
	const real = payload ? buildEventTemplate(eventType, payload) : null;
	if (real) return { ...real, badge: [tx("value.testBadge"), ...(real.badge ?? [])] };
	return genericSample(eventType, repo, repoUrl, actor);
}

/** Whether `/repo test` can show a lifelike message for this event. */
export function hasRealisticSample(eventType: EventType): boolean {
	return (
		samplePayload(eventType, {
			repo: "o/r",
			repoUrl: "https://github.com/o/r",
			actor: { login: "a" },
		}) !== undefined
	);
}

function genericSample(
	eventType: EventType,
	repo: string,
	repoUrl: string,
	actor: { login: string; avatarUrl?: string },
): EventTemplate {
	const meta = EVENT_META[eventType];
	return {
		accent: SAMPLE_ACCENTS[eventType] ?? "neutral",
		icon: meta.icon,
		title: tx("title.test"),
		subtitle: tx(`event.${eventType}.label` as TranslationKey),
		repo,
		repoUrl,
		actor,
		badge: [tx("value.testBadge")],
		body: `\`${eventType}\``,
		fields: [
			{ label: tx("field.state"), value: tx("value.testBody") },
			{
				label: tx("field.summary"),
				value: tx(`event.${eventType}.description` as TranslationKey),
				secondary: true,
			},
		],
		links: [{ label: tx("link.repository"), url: repoUrl }],
		timestamp: new Date(),
		importance: "normal",
	};
}
