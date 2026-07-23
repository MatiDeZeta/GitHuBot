import { z } from "zod";

export const actorSchema = z
	.object({
		login: z.string(),
		avatar_url: z.url().optional(),
		html_url: z.url().optional(),
	})
	.loose();

export const repositorySchema = z
	.object({
		full_name: z.string(),
		html_url: z.url(),
		name: z.string(),
		owner: z
			.object({
				login: z.string(),
				avatar_url: z.url().optional(),
			})
			.loose(),
	})
	.loose();

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

export const pushPayloadSchema = z
	.object({
		ref: z.string(),
		before: z.string().optional(),
		after: z.string().optional(),
		compare: z.url().optional(),
		commits: z.array(commitSchema).default([]),
		head_commit: commitSchema.nullable().optional(),
		pusher: z
			.object({
				name: z.string().optional(),
				email: z.string().optional(),
			})
			.loose()
			.optional(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const pullRequestPayloadSchema = z
	.object({
		action: z.string(),
		number: z.number(),
		pull_request: z
			.object({
				html_url: z.url(),
				title: z.string(),
				body: z.string().nullable().optional(),
				merged: z.boolean().optional(),
				user: actorSchema.optional(),
				merged_by: actorSchema.nullable().optional(),
				base: z.object({ ref: z.string() }).loose().optional(),
				head: z.object({ ref: z.string() }).loose().optional(),
			})
			.loose(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const issuesPayloadSchema = z
	.object({
		action: z.string(),
		issue: z
			.object({
				html_url: z.url(),
				number: z.number(),
				title: z.string(),
				body: z.string().nullable().optional(),
				user: actorSchema.optional(),
			})
			.loose(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const issueCommentPayloadSchema = z
	.object({
		action: z.string(),
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
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const pullRequestReviewPayloadSchema = z
	.object({
		action: z.string(),
		review: z
			.object({
				html_url: z.url(),
				state: z.string(),
				body: z.string().nullable().optional(),
				user: actorSchema.optional(),
			})
			.loose(),
		pull_request: z
			.object({
				html_url: z.url(),
				number: z.number(),
				title: z.string(),
			})
			.loose(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const releasePayloadSchema = z
	.object({
		action: z.string(),
		release: z
			.object({
				html_url: z.url(),
				tag_name: z.string(),
				name: z.string().nullable().optional(),
				body: z.string().nullable().optional(),
				prerelease: z.boolean().optional(),
				draft: z.boolean().optional(),
				author: actorSchema.optional(),
				assets: z.array(z.unknown()).optional(),
			})
			.loose(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const createDeletePayloadSchema = z
	.object({
		ref: z.string(),
		ref_type: z.union([z.enum(["branch", "tag"]), z.string()]),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const forkPayloadSchema = z
	.object({
		forkee: z
			.object({
				full_name: z.string(),
				html_url: z.url(),
				owner: actorSchema.optional(),
			})
			.loose(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const starPayloadSchema = z
	.object({
		action: z.string(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export const workflowRunPayloadSchema = z
	.object({
		action: z.string(),
		workflow_run: z
			.object({
				html_url: z.url(),
				name: z.string().nullable().optional(),
				display_title: z.string().optional(),
				conclusion: z.string().nullable().optional(),
				status: z.string().optional(),
				head_branch: z.string().nullable().optional(),
				actor: actorSchema.optional(),
			})
			.loose(),
		sender: actorSchema.optional(),
		repository: repositorySchema,
	})
	.loose();

export type PushPayload = z.infer<typeof pushPayloadSchema>;
export type PullRequestPayload = z.infer<typeof pullRequestPayloadSchema>;
export type IssuesPayload = z.infer<typeof issuesPayloadSchema>;
export type IssueCommentPayload = z.infer<typeof issueCommentPayloadSchema>;
export type PullRequestReviewPayload = z.infer<typeof pullRequestReviewPayloadSchema>;
export type ReleasePayload = z.infer<typeof releasePayloadSchema>;
export type CreateDeletePayload = z.infer<typeof createDeletePayloadSchema>;
export type ForkPayload = z.infer<typeof forkPayloadSchema>;
export type StarPayload = z.infer<typeof starPayloadSchema>;
export type WorkflowRunPayload = z.infer<typeof workflowRunPayloadSchema>;
