import { z } from "zod";
import type { IconKey } from "../design/tokens.js";

export const repoSlugSchema = z
	.string()
	.trim()
	.regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
		error: "Repository must be in owner/repo format",
	})
	.transform((value) => {
		const [owner, repo] = value.split("/");
		if (!owner || !repo) {
			throw new Error("Invalid repository slug");
		}
		return { owner, repo, slug: `${owner}/${repo}` };
	});

export type RepoSlug = z.infer<typeof repoSlugSchema>;

export const EVENT_TYPES = [
	// code
	"push",
	"create",
	"delete",
	"commit_comment",
	// pulls
	"pull_request",
	"pull_request_review",
	"pull_request_review_comment",
	"pull_request_review_thread",
	// issues
	"issues",
	"issue_comment",
	"label",
	"milestone",
	// ci/cd
	"workflow_run",
	"workflow_job",
	"check_run",
	"check_suite",
	"status",
	"deployment",
	"deployment_status",
	// releases
	"release",
	"package",
	"registry_package",
	// discussions
	"discussion",
	"discussion_comment",
	// security
	"dependabot_alert",
	"code_scanning_alert",
	"secret_scanning_alert",
	"secret_scanning_alert_location",
	"security_advisory",
	"branch_protection_rule",
	"branch_protection_configuration",
	// community
	"fork",
	"star",
	"sponsorship",
	"member",
	"public",
	// meta
	"repository",
	"gollum",
	"projects_v2_item",
	"deploy_key",
	"meta",
	"page_build",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_CATEGORY_IDS = [
	"code",
	"pulls",
	"issues",
	"cicd",
	"releases",
	"discussions",
	"security",
	"community",
	"meta",
] as const;

export type EventCategoryId = (typeof EVENT_CATEGORY_IDS)[number];

export interface EventCategory {
	id: EventCategoryId;
	icon: IconKey;
}

export const EVENT_CATEGORIES: readonly EventCategory[] = [
	{ id: "code", icon: "commit" },
	{ id: "pulls", icon: "pullRequest" },
	{ id: "issues", icon: "issue" },
	{ id: "cicd", icon: "workflow" },
	{ id: "releases", icon: "release" },
	{ id: "discussions", icon: "discussion" },
	{ id: "security", icon: "shield" },
	{ id: "community", icon: "star" },
	{ id: "meta", icon: "gear" },
] as const;

export interface EventMeta {
	category: EventCategoryId;
	/** Whether a freshly tracked repository posts this event out of the box. */
	defaultOn: boolean;
	icon: IconKey;
}

export const EVENT_META: Record<EventType, EventMeta> = {
	push: { category: "code", defaultOn: true, icon: "push" },
	create: { category: "code", defaultOn: true, icon: "branch" },
	delete: { category: "code", defaultOn: true, icon: "trash" },
	commit_comment: { category: "code", defaultOn: false, icon: "comment" },

	pull_request: { category: "pulls", defaultOn: true, icon: "pullRequest" },
	pull_request_review: { category: "pulls", defaultOn: false, icon: "review" },
	pull_request_review_comment: { category: "pulls", defaultOn: false, icon: "comment" },
	pull_request_review_thread: { category: "pulls", defaultOn: false, icon: "comment" },

	issues: { category: "issues", defaultOn: true, icon: "issue" },
	issue_comment: { category: "issues", defaultOn: false, icon: "comment" },
	label: { category: "issues", defaultOn: false, icon: "label" },
	milestone: { category: "issues", defaultOn: false, icon: "milestone" },

	workflow_run: { category: "cicd", defaultOn: false, icon: "workflow" },
	workflow_job: { category: "cicd", defaultOn: false, icon: "running" },
	check_run: { category: "cicd", defaultOn: false, icon: "success" },
	check_suite: { category: "cicd", defaultOn: false, icon: "success" },
	status: { category: "cicd", defaultOn: false, icon: "clock" },
	deployment: { category: "cicd", defaultOn: false, icon: "deployment" },
	deployment_status: { category: "cicd", defaultOn: false, icon: "rocket" },

	release: { category: "releases", defaultOn: true, icon: "release" },
	package: { category: "releases", defaultOn: false, icon: "packageIcon" },
	registry_package: { category: "releases", defaultOn: false, icon: "packageIcon" },

	discussion: { category: "discussions", defaultOn: false, icon: "discussion" },
	discussion_comment: { category: "discussions", defaultOn: false, icon: "comment" },

	dependabot_alert: { category: "security", defaultOn: false, icon: "shield" },
	code_scanning_alert: { category: "security", defaultOn: false, icon: "alert" },
	secret_scanning_alert: { category: "security", defaultOn: false, icon: "key" },
	secret_scanning_alert_location: { category: "security", defaultOn: false, icon: "key" },
	security_advisory: { category: "security", defaultOn: false, icon: "alert" },
	branch_protection_rule: { category: "security", defaultOn: false, icon: "shield" },
	branch_protection_configuration: { category: "security", defaultOn: false, icon: "shield" },

	fork: { category: "community", defaultOn: false, icon: "fork" },
	star: { category: "community", defaultOn: false, icon: "star" },
	sponsorship: { category: "community", defaultOn: false, icon: "sponsor" },
	member: { category: "community", defaultOn: false, icon: "person" },
	public: { category: "community", defaultOn: false, icon: "globe" },

	repository: { category: "meta", defaultOn: false, icon: "repo" },
	gollum: { category: "meta", defaultOn: false, icon: "wiki" },
	projects_v2_item: { category: "meta", defaultOn: false, icon: "project" },
	deploy_key: { category: "meta", defaultOn: false, icon: "key" },
	meta: { category: "meta", defaultOn: false, icon: "gear" },
	page_build: { category: "meta", defaultOn: false, icon: "globe" },
};

export const DEFAULT_ENABLED_EVENTS: EventType[] = EVENT_TYPES.filter(
	(event) => EVENT_META[event].defaultOn,
);

export const eventTypeSchema = z.enum(EVENT_TYPES);

export function eventsInCategory(category: EventCategoryId): EventType[] {
	return EVENT_TYPES.filter((event) => EVENT_META[event].category === category);
}

export function categoryOf(event: EventType): EventCategoryId {
	return EVENT_META[event].category;
}

export function parseEnabledEvents(raw: unknown): EventType[] {
	if (typeof raw === "string") {
		try {
			return parseEnabledEvents(JSON.parse(raw));
		} catch {
			return [...DEFAULT_ENABLED_EVENTS];
		}
	}
	if (!Array.isArray(raw)) {
		return [...DEFAULT_ENABLED_EVENTS];
	}
	// Tolerate rows written by older versions that may contain retired event names.
	const known = new Set<string>(EVENT_TYPES);
	return raw.filter((value): value is EventType => typeof value === "string" && known.has(value));
}

/**
 * Map the `X-GitHub-Event` header to our internal event type.
 * GitHub sends `watch` for stars; everything else maps one-to-one.
 */
export function githubEventToType(event: string): EventType | null {
	if (event === "watch") return "star";
	if ((EVENT_TYPES as readonly string[]).includes(event)) {
		return event as EventType;
	}
	return null;
}
