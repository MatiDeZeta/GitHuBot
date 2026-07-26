import type {
	DiscussionCommentPayload,
	DiscussionPayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { EventTemplate, TemplateField } from "../template.js";
import { actorBits, code, links, numbered, quote, repoBits, repositoryLink } from "./common.js";

function categoryField(
	category: { name?: string; emoji?: string } | undefined,
): TemplateField[] {
	if (!category?.name) return [];
	const label = category.emoji ? `${category.emoji} ${category.name}` : category.name;
	return [{ label: tx("field.category"), value: code(label), secondary: true }];
}

export function formatDiscussion(payload: DiscussionPayload): EventTemplate | null {
	const discussion = payload.discussion;
	const bits = repoBits(payload.repository);

	let title: ReturnType<typeof tx>;
	let accent: EventTemplate["accent"] = "discussion";
	let iconKey: EventTemplate["icon"] = "discussion";

	switch (payload.action) {
		case "created":
			title = tx("title.discussion.created");
			break;
		case "answered":
			title = tx("title.discussion.answered");
			accent = "discussionAnswered";
			iconKey = "answered";
			break;
		case "closed":
			title = tx("title.discussion.closed");
			accent = "issueClosed";
			iconKey = "closed";
			break;
		case "reopened":
			title = tx("title.discussion.reopened");
			break;
		default:
			return null;
	}

	return {
		accent,
		icon: iconKey,
		title,
		subtitle: numbered(discussion.number, discussion.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(discussion.user ?? payload.sender),
		body: payload.action === "created" ? quote(discussion.body, 500) : undefined,
		fields: categoryField(discussion.category),
		links: links(
			{ label: tx("link.discussion"), url: discussion.html_url },
			{ label: tx("link.answer"), url: discussion.answer_html_url ?? undefined },
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatDiscussionComment(
	payload: DiscussionCommentPayload,
): EventTemplate | null {
	if (payload.action !== "created") return null;
	const bits = repoBits(payload.repository);

	return {
		accent: "comment",
		icon: "comment",
		title: tx("title.discussionComment"),
		subtitle: numbered(payload.discussion.number, payload.discussion.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.comment.user ?? payload.sender),
		body: quote(payload.comment.body, 500),
		fields: categoryField(payload.discussion.category),
		links: links(
			{ label: tx("link.comment"), url: payload.comment.html_url },
			{ label: tx("link.discussion"), url: payload.discussion.html_url },
		),
		timestamp: new Date(),
		importance: "low",
	};
}
