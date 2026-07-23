import type { EventType } from "../../config/events.js";
import {
	createDeletePayloadSchema,
	forkPayloadSchema,
	issueCommentPayloadSchema,
	issuesPayloadSchema,
	pullRequestPayloadSchema,
	pullRequestReviewPayloadSchema,
	pushPayloadSchema,
	releasePayloadSchema,
	starPayloadSchema,
	workflowRunPayloadSchema,
} from "../../github/payloads.js";
import { formatCreate, formatDelete } from "./create-delete.js";
import { formatFork } from "./fork.js";
import { formatIssueComment } from "./issue-comment.js";
import { formatIssues } from "./issues.js";
import { formatPullRequest } from "./pull-request.js";
import { formatPullRequestReview } from "./pull-request-review.js";
import { formatPush } from "./push.js";
import { formatRelease } from "./release.js";
import type { FormattedMessage } from "./shared.js";
import { formatStar } from "./star.js";
import { formatWorkflowRun } from "./workflow-run.js";

export type { FormattedMessage } from "./shared.js";
export { Accents } from "./design.js";

export function formatGitHubEvent(
	eventType: EventType,
	payload: unknown,
): FormattedMessage | null {
	switch (eventType) {
		case "push": {
			const parsed = pushPayloadSchema.safeParse(payload);
			return parsed.success ? formatPush(parsed.data) : null;
		}
		case "pull_request": {
			const parsed = pullRequestPayloadSchema.safeParse(payload);
			return parsed.success ? formatPullRequest(parsed.data) : null;
		}
		case "issues": {
			const parsed = issuesPayloadSchema.safeParse(payload);
			return parsed.success ? formatIssues(parsed.data) : null;
		}
		case "issue_comment": {
			const parsed = issueCommentPayloadSchema.safeParse(payload);
			return parsed.success ? formatIssueComment(parsed.data) : null;
		}
		case "pull_request_review": {
			const parsed = pullRequestReviewPayloadSchema.safeParse(payload);
			return parsed.success ? formatPullRequestReview(parsed.data) : null;
		}
		case "release": {
			const parsed = releasePayloadSchema.safeParse(payload);
			return parsed.success ? formatRelease(parsed.data) : null;
		}
		case "create": {
			const parsed = createDeletePayloadSchema.safeParse(payload);
			return parsed.success ? formatCreate(parsed.data) : null;
		}
		case "delete": {
			const parsed = createDeletePayloadSchema.safeParse(payload);
			return parsed.success ? formatDelete(parsed.data) : null;
		}
		case "fork": {
			const parsed = forkPayloadSchema.safeParse(payload);
			return parsed.success ? formatFork(parsed.data) : null;
		}
		case "star": {
			const parsed = starPayloadSchema.safeParse(payload);
			return parsed.success ? formatStar(parsed.data) : null;
		}
		case "workflow_run": {
			const parsed = workflowRunPayloadSchema.safeParse(payload);
			return parsed.success ? formatWorkflowRun(parsed.data) : null;
		}
		default:
			return null;
	}
}
