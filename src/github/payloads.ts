import { z } from "zod";

/**
 * Schemas are deliberately permissive (`.loose()`, most fields optional).
 * GitHub adds payload fields regularly and a strict schema would silently drop
 * deliveries, so we validate only what the renderers actually read.
 */

export const actorSchema = z
	.object({
		login: z.string(),
		avatar_url: z.url().optional(),
		html_url: z.url().optional(),
		type: z.string().optional(),
	})
	.loose();

export const repositorySchema = z
	.object({
		full_name: z.string(),
		html_url: z.url(),
		name: z.string(),
		language: z.string().nullable().optional(),
		default_branch: z.string().optional(),
		owner: z
			.object({
				login: z.string(),
				avatar_url: z.url().optional(),
			})
			.loose(),
	})
	.loose();

export const labelSchema = z
	.object({
		name: z.string(),
		color: z.string().optional(),
	})
	.loose();

/** Every webhook we render carries at least a repository; sender is near-universal. */
const baseEventSchema = z.object({
	sender: actorSchema.optional(),
	repository: repositorySchema,
});

const withAction = baseEventSchema.extend({ action: z.string() });

export const commitSchema = z
	.object({
		id: z.string(),
		message: z.string(),
		url: z.url(),
		author: z
			.object({
				name: z.string().optional(),
				username: z.string().optional(),
			})
			.loose()
			.optional()
			.nullable(),
		committer: z
			.object({
				name: z.string().optional(),
				username: z.string().optional(),
			})
			.loose()
			.optional()
			.nullable(),
	})
	.loose();

/* ------------------------------------------------------------------ code -- */

export const pushPayloadSchema = baseEventSchema
	.extend({
		ref: z.string(),
		before: z.string().optional(),
		after: z.string().optional(),
		compare: z.url().optional(),
		created: z.boolean().optional(),
		deleted: z.boolean().optional(),
		forced: z.boolean().optional(),
		commits: z.array(commitSchema).default([]),
		head_commit: commitSchema.nullable().optional(),
		pusher: z
			.object({
				name: z.string().optional(),
				email: z.string().optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

export const createDeletePayloadSchema = baseEventSchema
	.extend({
		ref: z.string(),
		ref_type: z.union([z.enum(["branch", "tag"]), z.string()]),
	})
	.loose();

export const commitCommentPayloadSchema = withAction
	.extend({
		comment: z
			.object({
				html_url: z.url(),
				body: z.string(),
				commit_id: z.string().optional(),
				path: z.string().nullable().optional(),
				user: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

/* ----------------------------------------------------------------- pulls -- */

const pullRequestRefSchema = z
	.object({
		html_url: z.url(),
		number: z.number(),
		title: z.string(),
		draft: z.boolean().optional(),
		user: actorSchema.optional(),
	})
	.loose();

export const pullRequestPayloadSchema = withAction
	.extend({
		number: z.number(),
		pull_request: z
			.object({
				html_url: z.url(),
				title: z.string(),
				body: z.string().nullable().optional(),
				merged: z.boolean().optional(),
				draft: z.boolean().optional(),
				additions: z.number().optional(),
				deletions: z.number().optional(),
				changed_files: z.number().optional(),
				commits: z.number().optional(),
				labels: z.array(labelSchema).optional(),
				user: actorSchema.optional(),
				merged_by: actorSchema.nullable().optional(),
				base: z.object({ ref: z.string() }).loose().optional(),
				head: z.object({ ref: z.string() }).loose().optional(),
			})
			.loose(),
	})
	.loose();

export const pullRequestReviewPayloadSchema = withAction
	.extend({
		review: z
			.object({
				html_url: z.url(),
				state: z.string(),
				body: z.string().nullable().optional(),
				user: actorSchema.optional(),
			})
			.loose(),
		pull_request: pullRequestRefSchema,
	})
	.loose();

export const pullRequestReviewCommentPayloadSchema = withAction
	.extend({
		comment: z
			.object({
				html_url: z.url(),
				body: z.string(),
				path: z.string().optional(),
				line: z.number().nullable().optional(),
				user: actorSchema.optional(),
			})
			.loose(),
		pull_request: pullRequestRefSchema,
	})
	.loose();

export const pullRequestReviewThreadPayloadSchema = withAction
	.extend({
		thread: z
			.object({
				comments: z
					.array(
						z
							.object({
								html_url: z.url().optional(),
								path: z.string().optional(),
								body: z.string().optional(),
							})
							.loose(),
					)
					.optional(),
			})
			.loose()
			.optional(),
		pull_request: pullRequestRefSchema,
	})
	.loose();

/* ---------------------------------------------------------------- issues -- */

export const issuesPayloadSchema = withAction
	.extend({
		issue: z
			.object({
				html_url: z.url(),
				number: z.number(),
				title: z.string(),
				body: z.string().nullable().optional(),
				state_reason: z.string().nullable().optional(),
				labels: z.array(labelSchema).optional(),
				user: actorSchema.optional(),
			})
			.loose(),
		label: labelSchema.optional(),
		assignee: actorSchema.nullable().optional(),
	})
	.loose();

export const issueCommentPayloadSchema = withAction
	.extend({
		issue: z
			.object({
				html_url: z.url(),
				number: z.number(),
				title: z.string(),
				pull_request: z.unknown().optional(),
			})
			.loose(),
		comment: z
			.object({
				html_url: z.url(),
				body: z.string(),
				user: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

export const labelPayloadSchema = withAction
	.extend({
		label: labelSchema,
	})
	.loose();

export const milestonePayloadSchema = withAction
	.extend({
		milestone: z
			.object({
				html_url: z.url(),
				title: z.string(),
				number: z.number().optional(),
				description: z.string().nullable().optional(),
				open_issues: z.number().optional(),
				closed_issues: z.number().optional(),
				due_on: z.string().nullable().optional(),
			})
			.loose(),
	})
	.loose();

/* ------------------------------------------------------------------ ci/cd -- */

export const workflowRunPayloadSchema = withAction
	.extend({
		workflow_run: z
			.object({
				html_url: z.url(),
				name: z.string().nullable().optional(),
				display_title: z.string().optional(),
				conclusion: z.string().nullable().optional(),
				status: z.string().optional(),
				event: z.string().optional(),
				run_number: z.number().optional(),
				run_attempt: z.number().optional(),
				head_branch: z.string().nullable().optional(),
				run_started_at: z.string().optional(),
				updated_at: z.string().optional(),
				actor: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

export const workflowJobPayloadSchema = withAction
	.extend({
		workflow_job: z
			.object({
				html_url: z.url(),
				name: z.string(),
				status: z.string().optional(),
				conclusion: z.string().nullable().optional(),
				head_branch: z.string().nullable().optional(),
				runner_name: z.string().nullable().optional(),
			})
			.loose(),
	})
	.loose();

export const checkRunPayloadSchema = withAction
	.extend({
		check_run: z
			.object({
				html_url: z.url().optional(),
				name: z.string(),
				status: z.string().optional(),
				conclusion: z.string().nullable().optional(),
				output: z
					.object({
						title: z.string().nullable().optional(),
						summary: z.string().nullable().optional(),
					})
					.loose()
					.optional(),
				check_suite: z
					.object({ head_branch: z.string().nullable().optional() })
					.loose()
					.optional(),
			})
			.loose(),
	})
	.loose();

export const checkSuitePayloadSchema = withAction
	.extend({
		check_suite: z
			.object({
				status: z.string().optional(),
				conclusion: z.string().nullable().optional(),
				head_branch: z.string().nullable().optional(),
				head_sha: z.string().optional(),
				app: z.object({ name: z.string().optional() }).loose().optional(),
			})
			.loose(),
	})
	.loose();

export const statusPayloadSchema = baseEventSchema
	.extend({
		sha: z.string(),
		state: z.string(),
		context: z.string().optional(),
		description: z.string().nullable().optional(),
		target_url: z.url().nullable().optional(),
	})
	.loose();

export const deploymentPayloadSchema = withAction
	.extend({
		deployment: z
			.object({
				environment: z.string().optional(),
				ref: z.string().optional(),
				description: z.string().nullable().optional(),
				creator: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

export const deploymentStatusPayloadSchema = withAction
	.extend({
		deployment: z
			.object({
				environment: z.string().optional(),
				ref: z.string().optional(),
			})
			.loose(),
		deployment_status: z
			.object({
				state: z.string(),
				description: z.string().nullable().optional(),
				environment_url: z.string().nullable().optional(),
				target_url: z.string().nullable().optional(),
				log_url: z.string().nullable().optional(),
				creator: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

/* -------------------------------------------------------------- releases -- */

export const releasePayloadSchema = withAction
	.extend({
		release: z
			.object({
				html_url: z.url(),
				tag_name: z.string(),
				name: z.string().nullable().optional(),
				body: z.string().nullable().optional(),
				prerelease: z.boolean().optional(),
				draft: z.boolean().optional(),
				author: actorSchema.optional(),
				assets: z
					.array(
						z
							.object({
								name: z.string().optional(),
								browser_download_url: z.string().optional(),
								download_count: z.number().optional(),
							})
							.loose(),
					)
					.optional(),
			})
			.loose(),
	})
	.loose();

export const packagePayloadSchema = withAction
	.extend({
		package: z
			.object({
				name: z.string(),
				package_type: z.string().optional(),
				html_url: z.url().optional(),
				package_version: z
					.object({
						version: z.string().optional(),
						html_url: z.url().optional(),
					})
					.loose()
					.nullable()
					.optional(),
			})
			.loose()
			.optional(),
		registry_package: z
			.object({
				name: z.string(),
				package_type: z.string().optional(),
				html_url: z.url().optional(),
				package_version: z
					.object({
						version: z.string().optional(),
						html_url: z.url().optional(),
					})
					.loose()
					.nullable()
					.optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

/* ----------------------------------------------------------- discussions -- */

const discussionSchema = z
	.object({
		html_url: z.url(),
		number: z.number(),
		title: z.string(),
		body: z.string().nullable().optional(),
		answer_html_url: z.string().nullable().optional(),
		category: z
			.object({ name: z.string().optional(), emoji: z.string().optional() })
			.loose()
			.optional(),
		user: actorSchema.optional(),
	})
	.loose();

export const discussionPayloadSchema = withAction
	.extend({ discussion: discussionSchema })
	.loose();

export const discussionCommentPayloadSchema = withAction
	.extend({
		discussion: discussionSchema,
		comment: z
			.object({
				html_url: z.url(),
				body: z.string(),
				user: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

/* -------------------------------------------------------------- security -- */

export const dependabotAlertPayloadSchema = withAction
	.extend({
		alert: z
			.object({
				html_url: z.url().optional(),
				number: z.number().optional(),
				state: z.string().optional(),
				security_advisory: z
					.object({
						summary: z.string().optional(),
						severity: z.string().optional(),
						cve_id: z.string().nullable().optional(),
					})
					.loose()
					.optional(),
				dependency: z
					.object({
						package: z
							.object({ name: z.string().optional(), ecosystem: z.string().optional() })
							.loose()
							.optional(),
						manifest_path: z.string().optional(),
					})
					.loose()
					.optional(),
			})
			.loose(),
	})
	.loose();

export const codeScanningAlertPayloadSchema = withAction
	.extend({
		alert: z
			.object({
				html_url: z.url().optional(),
				number: z.number().optional(),
				state: z.string().optional(),
				rule: z
					.object({
						id: z.string().optional(),
						description: z.string().optional(),
						severity: z.string().nullable().optional(),
						security_severity_level: z.string().nullable().optional(),
					})
					.loose()
					.optional(),
				most_recent_instance: z
					.object({
						location: z.object({ path: z.string().optional() }).loose().optional(),
					})
					.loose()
					.optional(),
			})
			.loose(),
		ref: z.string().optional(),
	})
	.loose();

export const secretScanningAlertPayloadSchema = withAction
	.extend({
		alert: z
			.object({
				html_url: z.url().optional(),
				number: z.number().optional(),
				state: z.string().optional(),
				secret_type_display_name: z.string().optional(),
				secret_type: z.string().optional(),
				resolution: z.string().nullable().optional(),
			})
			.loose(),
		location: z
			.object({ type: z.string().optional() })
			.loose()
			.optional(),
	})
	.loose();

export const securityAdvisoryPayloadSchema = withAction
	.extend({
		security_advisory: z
			.object({
				ghsa_id: z.string().optional(),
				summary: z.string().optional(),
				severity: z.string().optional(),
				cve_id: z.string().nullable().optional(),
				references: z
					.array(z.object({ url: z.string().optional() }).loose())
					.optional(),
			})
			.loose(),
	})
	.loose();

export const branchProtectionRulePayloadSchema = withAction
	.extend({
		rule: z
			.object({
				name: z.string().optional(),
				id: z.number().optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

/* ------------------------------------------------------------- community -- */

export const forkPayloadSchema = baseEventSchema
	.extend({
		forkee: z
			.object({
				full_name: z.string(),
				html_url: z.url(),
				owner: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

export const starPayloadSchema = withAction
	.extend({
		starred_at: z.string().nullable().optional(),
	})
	.loose();

export const sponsorshipPayloadSchema = withAction
	.extend({
		sponsorship: z
			.object({
				sponsor: actorSchema.optional(),
				sponsorable: actorSchema.optional(),
				tier: z
					.object({
						name: z.string().optional(),
						monthly_price_in_dollars: z.number().optional(),
						is_one_time: z.boolean().optional(),
					})
					.loose()
					.optional(),
			})
			.loose(),
	})
	.loose();

export const memberPayloadSchema = withAction
	.extend({
		member: actorSchema,
		changes: z
			.object({
				permission: z.object({ to: z.string().optional() }).loose().optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

/** `public` carries no action and no extra fields beyond the base. */
export const publicPayloadSchema = baseEventSchema.loose();

/* ------------------------------------------------------------------ meta -- */

export const repositoryPayloadSchema = withAction
	.extend({
		changes: z
			.object({
				repository: z
					.object({
						name: z.object({ from: z.string().optional() }).loose().optional(),
					})
					.loose()
					.optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

export const gollumPayloadSchema = baseEventSchema
	.extend({
		pages: z
			.array(
				z
					.object({
						page_name: z.string(),
						title: z.string().optional(),
						action: z.string().optional(),
						html_url: z.url().optional(),
						summary: z.string().nullable().optional(),
					})
					.loose(),
			)
			.default([]),
	})
	.loose();

export const projectsV2ItemPayloadSchema = z
	.object({
		action: z.string(),
		sender: actorSchema.optional(),
		projects_v2_item: z
			.object({
				content_type: z.string().optional(),
				content_node_id: z.string().optional(),
				project_node_id: z.string().optional(),
			})
			.loose()
			.optional(),
		organization: z
			.object({ login: z.string().optional(), avatar_url: z.url().optional() })
			.loose()
			.optional(),
		repository: repositorySchema.optional(),
	})
	.loose();

export const deployKeyPayloadSchema = withAction
	.extend({
		key: z
			.object({
				title: z.string().optional(),
				read_only: z.boolean().optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

export const metaPayloadSchema = withAction
	.extend({
		hook_id: z.number().optional(),
		hook: z
			.object({
				events: z.array(z.string()).optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

export const pageBuildPayloadSchema = baseEventSchema
	.extend({
		build: z
			.object({
				status: z.string().optional(),
				url: z.string().optional(),
				error: z
					.object({ message: z.string().nullable().optional() })
					.loose()
					.optional(),
				pusher: actorSchema.optional(),
			})
			.loose(),
	})
	.loose();

/* ----------------------------------------------------------------- types -- */

export type Actor = z.infer<typeof actorSchema>;
export type Repository = z.infer<typeof repositorySchema>;
export type PushPayload = z.infer<typeof pushPayloadSchema>;
export type CreateDeletePayload = z.infer<typeof createDeletePayloadSchema>;
export type CommitCommentPayload = z.infer<typeof commitCommentPayloadSchema>;
export type PullRequestPayload = z.infer<typeof pullRequestPayloadSchema>;
export type PullRequestReviewPayload = z.infer<typeof pullRequestReviewPayloadSchema>;
export type PullRequestReviewCommentPayload = z.infer<
	typeof pullRequestReviewCommentPayloadSchema
>;
export type PullRequestReviewThreadPayload = z.infer<
	typeof pullRequestReviewThreadPayloadSchema
>;
export type IssuesPayload = z.infer<typeof issuesPayloadSchema>;
export type IssueCommentPayload = z.infer<typeof issueCommentPayloadSchema>;
export type LabelPayload = z.infer<typeof labelPayloadSchema>;
export type MilestonePayload = z.infer<typeof milestonePayloadSchema>;
export type WorkflowRunPayload = z.infer<typeof workflowRunPayloadSchema>;
export type WorkflowJobPayload = z.infer<typeof workflowJobPayloadSchema>;
export type CheckRunPayload = z.infer<typeof checkRunPayloadSchema>;
export type CheckSuitePayload = z.infer<typeof checkSuitePayloadSchema>;
export type StatusPayload = z.infer<typeof statusPayloadSchema>;
export type DeploymentPayload = z.infer<typeof deploymentPayloadSchema>;
export type DeploymentStatusPayload = z.infer<typeof deploymentStatusPayloadSchema>;
export type ReleasePayload = z.infer<typeof releasePayloadSchema>;
export type PackagePayload = z.infer<typeof packagePayloadSchema>;
export type DiscussionPayload = z.infer<typeof discussionPayloadSchema>;
export type DiscussionCommentPayload = z.infer<typeof discussionCommentPayloadSchema>;
export type DependabotAlertPayload = z.infer<typeof dependabotAlertPayloadSchema>;
export type CodeScanningAlertPayload = z.infer<typeof codeScanningAlertPayloadSchema>;
export type SecretScanningAlertPayload = z.infer<typeof secretScanningAlertPayloadSchema>;
export type SecurityAdvisoryPayload = z.infer<typeof securityAdvisoryPayloadSchema>;
export type BranchProtectionRulePayload = z.infer<typeof branchProtectionRulePayloadSchema>;
export type ForkPayload = z.infer<typeof forkPayloadSchema>;
export type StarPayload = z.infer<typeof starPayloadSchema>;
export type SponsorshipPayload = z.infer<typeof sponsorshipPayloadSchema>;
export type MemberPayload = z.infer<typeof memberPayloadSchema>;
export type PublicPayload = z.infer<typeof publicPayloadSchema>;
export type RepositoryPayload = z.infer<typeof repositoryPayloadSchema>;
export type GollumPayload = z.infer<typeof gollumPayloadSchema>;
export type ProjectsV2ItemPayload = z.infer<typeof projectsV2ItemPayloadSchema>;
export type DeployKeyPayload = z.infer<typeof deployKeyPayloadSchema>;
export type MetaPayload = z.infer<typeof metaPayloadSchema>;
export type PageBuildPayload = z.infer<typeof pageBuildPayloadSchema>;
