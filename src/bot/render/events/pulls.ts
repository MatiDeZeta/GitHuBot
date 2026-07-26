import type {
	PullRequestPayload,
	PullRequestReviewCommentPayload,
	PullRequestReviewPayload,
	PullRequestReviewThreadPayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { AccentKey, IconKey } from "../../../design/tokens.js";
import type { EventTemplate, TemplateField } from "../template.js";
import {
	actorBits,
	code,
	links,
	numbered,
	quote,
	repoBits,
	repositoryLink,
	titleText,
} from "./common.js";

export function formatPullRequest(payload: PullRequestPayload): EventTemplate | null {
	const { action, pull_request: pr } = payload;
	const bits = repoBits(payload.repository);

	let accent: AccentKey;
	let icon: IconKey;
	let title: ReturnType<typeof tx>;

	if (action === "opened") {
		accent = pr.draft ? "prDraft" : "prOpen";
		icon = pr.draft ? "pullRequestDraft" : "pullRequest";
		title = tx(pr.draft ? "title.pr.draft" : "title.pr.opened");
	} else if (action === "reopened") {
		accent = "prOpen";
		icon = "pullRequest";
		title = tx("title.pr.reopened");
	} else if (action === "closed" && pr.merged) {
		accent = "prMerged";
		icon = "merged";
		title = tx("title.pr.merged");
	} else if (action === "closed") {
		accent = "prClosed";
		icon = "closed";
		title = tx("title.pr.closed");
	} else if (action === "ready_for_review") {
		accent = "prOpen";
		icon = "pullRequest";
		title = tx("title.pr.readyForReview");
	} else if (action === "converted_to_draft") {
		accent = "prDraft";
		icon = "pullRequestDraft";
		title = tx("title.pr.convertedToDraft");
	} else {
		// `synchronize`, `edited`, `labeled`, … are too noisy to post.
		return null;
	}

	const fields: TemplateField[] = [];
	if (pr.head?.ref && pr.base?.ref) {
		fields.push({
			label: tx("field.branches"),
			value: tx("value.branchArrow", {
				head: `\`${pr.head.ref}\``,
				base: `\`${pr.base.ref}\``,
			}),
		});
	}
	if (typeof pr.additions === "number" && typeof pr.deletions === "number") {
		const files = pr.changed_files ?? 0;
		fields.push({
			label: tx("field.changes"),
			value: tx("value.diffstat", {
				additions: pr.additions,
				deletions: pr.deletions,
				files: files === 1 ? "1 file" : `${files} files`,
			}),
		});
	}
	const labels = (pr.labels ?? []).map((label) => label.name).filter(Boolean);
	if (labels.length > 0) {
		fields.push({
			label: tx("field.labels"),
			value: labels.slice(0, 8).map(code).join(" "),
			secondary: true,
		});
	}

	return {
		accent,
		icon,
		title,
		subtitle: numbered(payload.number, pr.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(pr.merged ? (pr.merged_by ?? payload.sender) : (pr.user ?? payload.sender)),
		body: action === "opened" ? quote(pr.body, 500) : undefined,
		fields: fields.length > 0 ? fields : undefined,
		links: links({ label: tx("link.pullRequest"), url: pr.html_url }, repositoryLink(bits)),
		timestamp: new Date(),
		importance: action === "closed" && pr.merged ? "high" : "normal",
	};
}

export function formatPullRequestReview(
	payload: PullRequestReviewPayload,
): EventTemplate | null {
	const { action, review, pull_request: pr } = payload;
	if (action !== "submitted" && action !== "dismissed") return null;

	const state = review.state.toLowerCase();
	// GitHub emits a `commented` review for every inline comment batch; those
	// arrive separately as review comments, so only post substantive reviews.
	if (action === "submitted" && state === "commented" && !review.body?.trim()) return null;

	let accent: AccentKey = "review";
	let icon: IconKey = "review";
	let title = tx("title.review.commented");

	if (action === "dismissed") {
		accent = "comment";
		icon = "closed";
		title = tx("title.review.dismissed");
	} else if (state === "approved") {
		accent = "reviewApproved";
		icon = "approved";
		title = tx("title.review.approved");
	} else if (state === "changes_requested") {
		accent = "reviewChanges";
		icon = "changesRequested";
		title = tx("title.review.changesRequested");
	}

	const bits = repoBits(payload.repository);
	return {
		accent,
		icon,
		title,
		subtitle: numbered(pr.number, pr.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(review.user ?? payload.sender),
		body: quote(review.body, 500),
		links: links(
			{ label: tx("link.review"), url: review.html_url },
			{ label: tx("link.pullRequest"), url: pr.html_url },
		),
		timestamp: new Date(),
		importance: state === "changes_requested" ? "high" : "normal",
	};
}

export function formatPullRequestReviewComment(
	payload: PullRequestReviewCommentPayload,
): EventTemplate | null {
	if (payload.action !== "created") return null;
	const bits = repoBits(payload.repository);
	const { comment, pull_request: pr } = payload;

	const location = comment.path
		? `${comment.path}${comment.line ? `:${comment.line}` : ""}`
		: undefined;

	return {
		accent: "comment",
		icon: "comment",
		title: tx("title.reviewComment"),
		subtitle: numbered(pr.number, pr.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(comment.user ?? payload.sender),
		body: quote(comment.body, 400),
		fields: location
			? [{ label: tx("field.path"), value: code(titleText(location, 120)) }]
			: undefined,
		links: links(
			{ label: tx("link.comment"), url: comment.html_url },
			{ label: tx("link.pullRequest"), url: pr.html_url },
		),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatPullRequestReviewThread(
	payload: PullRequestReviewThreadPayload,
): EventTemplate | null {
	const resolved = payload.action === "resolved";
	if (!resolved && payload.action !== "unresolved") return null;

	const bits = repoBits(payload.repository);
	const pr = payload.pull_request;
	const path = payload.thread?.comments?.[0]?.path;

	return {
		accent: resolved ? "reviewApproved" : "reviewChanges",
		icon: resolved ? "approved" : "comment",
		title: tx(resolved ? "title.reviewThread.resolved" : "title.reviewThread.unresolved"),
		subtitle: numbered(pr.number, pr.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields: path ? [{ label: tx("field.path"), value: code(titleText(path, 120)) }] : undefined,
		links: links({ label: tx("link.pullRequest"), url: pr.html_url }),
		timestamp: new Date(),
		importance: "low",
	};
}
