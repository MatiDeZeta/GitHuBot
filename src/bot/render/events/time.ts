import type { EventType } from "../../../config/events.js";

/**
 * Where each event says it happened, most specific first. Without this every message
 * showed the moment GitHuBot *received* it, so a redelivery or a delayed webhook read
 * "just now" for something that happened days earlier.
 *
 * Push uses `repository.pushed_at` rather than the head commit's timestamp: a commit
 * authored last week and pushed today was pushed today.
 */
const TIME_PATHS: Partial<Record<EventType, string[]>> = {
	push: ["repository.pushed_at"],
	commit_comment: ["comment.created_at"],
	pull_request: ["pull_request.updated_at"],
	pull_request_review: ["review.submitted_at"],
	pull_request_review_comment: ["comment.updated_at"],
	pull_request_review_thread: ["thread.comments.0.updated_at", "pull_request.updated_at"],
	issues: ["issue.updated_at"],
	issue_comment: ["comment.updated_at"],
	milestone: ["milestone.updated_at"],
	workflow_run: ["workflow_run.updated_at"],
	workflow_job: ["workflow_job.completed_at", "workflow_job.started_at"],
	check_run: ["check_run.completed_at", "check_run.started_at"],
	check_suite: ["check_suite.updated_at"],
	status: ["updated_at"],
	deployment: ["deployment.updated_at"],
	deployment_status: ["deployment_status.updated_at"],
	release: ["release.published_at", "release.created_at"],
	package: ["package.updated_at"],
	registry_package: ["registry_package.updated_at"],
	discussion: ["discussion.updated_at"],
	discussion_comment: ["comment.updated_at"],
	dependabot_alert: ["alert.updated_at"],
	code_scanning_alert: ["alert.updated_at", "alert.created_at"],
	secret_scanning_alert: ["alert.updated_at", "alert.created_at"],
	repository_advisory: ["repository_advisory.updated_at"],
	star: ["starred_at"],
	fork: ["forkee.created_at"],
};

/** Clock skew allowance: a time a little ahead of ours is still believable. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** The time the payload says the event happened, or undefined when it does not say. */
export function eventTime(eventType: EventType, payload: unknown): Date | undefined {
	for (const path of TIME_PATHS[eventType] ?? []) {
		const date = toDate(read(payload, path));
		if (date) return date;
	}
	return undefined;
}

function read(value: unknown, path: string): unknown {
	let current = value;
	for (const key of path.split(".")) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

/** ISO strings, and the Unix seconds GitHub uses for `repository.pushed_at` on pushes. */
function toDate(value: unknown): Date | undefined {
	const date =
		typeof value === "string"
			? new Date(value)
			: typeof value === "number"
				? new Date(value * 1000)
				: undefined;
	if (!date || Number.isNaN(date.getTime())) return undefined;
	if (date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) return undefined;
	return date;
}
