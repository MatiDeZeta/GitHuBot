import { EVENT_META, type EventType } from "../../config/events.js";
import { tx, type TranslationKey } from "../../i18n/index.js";
import type { EventTemplate } from "./template.js";

/** Accent chosen so a test message looks like the real thing for that event. */
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

/**
 * Builds a representative message for `/repo test` without inventing a fake
 * GitHub payload for each of the ~40 event types.
 */
export function sampleTemplate(
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
