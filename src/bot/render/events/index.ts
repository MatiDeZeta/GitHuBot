import type { EventType } from "../../../config/events.js";
import {
	branchProtectionRulePayloadSchema,
	checkRunPayloadSchema,
	checkSuitePayloadSchema,
	codeScanningAlertPayloadSchema,
	commitCommentPayloadSchema,
	createDeletePayloadSchema,
	dependabotAlertPayloadSchema,
	deployKeyPayloadSchema,
	deploymentPayloadSchema,
	deploymentStatusPayloadSchema,
	discussionCommentPayloadSchema,
	discussionPayloadSchema,
	forkPayloadSchema,
	gollumPayloadSchema,
	issueCommentPayloadSchema,
	issuesPayloadSchema,
	labelPayloadSchema,
	memberPayloadSchema,
	metaPayloadSchema,
	milestonePayloadSchema,
	packagePayloadSchema,
	pageBuildPayloadSchema,
	projectsV2ItemPayloadSchema,
	publicPayloadSchema,
	pullRequestPayloadSchema,
	pullRequestReviewCommentPayloadSchema,
	pullRequestReviewPayloadSchema,
	pullRequestReviewThreadPayloadSchema,
	pushPayloadSchema,
	releasePayloadSchema,
	repositoryPayloadSchema,
	secretScanningAlertPayloadSchema,
	securityAdvisoryPayloadSchema,
	sponsorshipPayloadSchema,
	starPayloadSchema,
	statusPayloadSchema,
	workflowJobPayloadSchema,
	workflowRunPayloadSchema,
} from "../../../github/payloads.js";
import type { EventTemplate } from "../template.js";
import { formatCommitComment, formatCreate, formatDelete, formatPush } from "./code.js";
import {
	formatFork,
	formatMember,
	formatPublic,
	formatSponsorship,
	formatStar,
} from "./community.js";
import { formatDiscussion, formatDiscussionComment } from "./discussions.js";
import {
	formatCheckRun,
	formatCheckSuite,
	formatDeployment,
	formatDeploymentStatus,
	formatStatus,
	formatWorkflowJob,
	formatWorkflowRun,
} from "./cicd.js";
import { formatIssueComment, formatIssues, formatLabel, formatMilestone } from "./issues.js";
import {
	formatDeployKey,
	formatGollum,
	formatMeta,
	formatPageBuild,
	formatProjectsV2Item,
	formatRepository,
} from "./meta.js";
import {
	formatPullRequest,
	formatPullRequestReview,
	formatPullRequestReviewComment,
	formatPullRequestReviewThread,
} from "./pulls.js";
import { formatPackage, formatRelease } from "./releases.js";
import {
	formatBranchProtectionConfiguration,
	formatBranchProtectionRule,
	formatCodeScanningAlert,
	formatDependabotAlert,
	formatSecretScanningAlert,
	formatSecretScanningAlertLocation,
	formatSecurityAdvisory,
} from "./security.js";

/** Parses a raw webhook body, then formats it. Returns null to skip posting. */
export type EventBuilder = (payload: unknown) => EventTemplate | null;

function build<T>(
	schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
	format: (payload: T) => EventTemplate | null,
): EventBuilder {
	return (payload: unknown) => {
		const parsed = schema.safeParse(payload);
		return parsed.success ? format(parsed.data) : null;
	};
}

export const EVENT_BUILDERS: Record<EventType, EventBuilder> = {
	push: build(pushPayloadSchema, formatPush),
	create: build(createDeletePayloadSchema, formatCreate),
	delete: build(createDeletePayloadSchema, formatDelete),
	commit_comment: build(commitCommentPayloadSchema, formatCommitComment),

	pull_request: build(pullRequestPayloadSchema, formatPullRequest),
	pull_request_review: build(pullRequestReviewPayloadSchema, formatPullRequestReview),
	pull_request_review_comment: build(
		pullRequestReviewCommentPayloadSchema,
		formatPullRequestReviewComment,
	),
	pull_request_review_thread: build(
		pullRequestReviewThreadPayloadSchema,
		formatPullRequestReviewThread,
	),

	issues: build(issuesPayloadSchema, formatIssues),
	issue_comment: build(issueCommentPayloadSchema, formatIssueComment),
	label: build(labelPayloadSchema, formatLabel),
	milestone: build(milestonePayloadSchema, formatMilestone),

	workflow_run: build(workflowRunPayloadSchema, formatWorkflowRun),
	workflow_job: build(workflowJobPayloadSchema, formatWorkflowJob),
	check_run: build(checkRunPayloadSchema, formatCheckRun),
	check_suite: build(checkSuitePayloadSchema, formatCheckSuite),
	status: build(statusPayloadSchema, formatStatus),
	deployment: build(deploymentPayloadSchema, formatDeployment),
	deployment_status: build(deploymentStatusPayloadSchema, formatDeploymentStatus),

	release: build(releasePayloadSchema, formatRelease),
	package: build(packagePayloadSchema, formatPackage),
	registry_package: build(packagePayloadSchema, formatPackage),

	discussion: build(discussionPayloadSchema, formatDiscussion),
	discussion_comment: build(discussionCommentPayloadSchema, formatDiscussionComment),

	dependabot_alert: build(dependabotAlertPayloadSchema, formatDependabotAlert),
	code_scanning_alert: build(codeScanningAlertPayloadSchema, formatCodeScanningAlert),
	secret_scanning_alert: build(secretScanningAlertPayloadSchema, formatSecretScanningAlert),
	secret_scanning_alert_location: build(
		secretScanningAlertPayloadSchema,
		formatSecretScanningAlertLocation,
	),
	security_advisory: build(securityAdvisoryPayloadSchema, formatSecurityAdvisory),
	branch_protection_rule: build(branchProtectionRulePayloadSchema, formatBranchProtectionRule),
	branch_protection_configuration: build(
		branchProtectionRulePayloadSchema,
		formatBranchProtectionConfiguration,
	),

	fork: build(forkPayloadSchema, formatFork),
	star: build(starPayloadSchema, formatStar),
	sponsorship: build(sponsorshipPayloadSchema, formatSponsorship),
	member: build(memberPayloadSchema, formatMember),
	public: build(publicPayloadSchema, formatPublic),

	repository: build(repositoryPayloadSchema, formatRepository),
	gollum: build(gollumPayloadSchema, formatGollum),
	projects_v2_item: build(projectsV2ItemPayloadSchema, formatProjectsV2Item),
	deploy_key: build(deployKeyPayloadSchema, formatDeployKey),
	meta: build(metaPayloadSchema, formatMeta),
	page_build: build(pageBuildPayloadSchema, formatPageBuild),
};

export function buildEventTemplate(
	eventType: EventType,
	payload: unknown,
): EventTemplate | null {
	return EVENT_BUILDERS[eventType](payload);
}
