import type { IssueCommentPayload } from "../../github/payloads.js";
import { Accents, truncate } from "./design.js";
import {
	authorSection,
	buildMessage,
	container,
	linkButton,
	linkRow,
	separator,
	text,
	type FormattedMessage,
} from "./shared.js";

export function formatIssueComment(payload: IssueCommentPayload): FormattedMessage | null {
	if (payload.action !== "created") return null;

	const isPr = Boolean(payload.issue.pull_request);
	const repo = payload.repository.full_name;
	const author = payload.comment.user ?? payload.sender;
	const label = isPr ? "PR comment" : "Issue comment";

	const c = container(Accents.comment);
	c.addSectionComponents(
		authorSection(
			[
				`**${repo}**`,
				`${label} on [#${payload.issue.number}](${payload.issue.html_url}) · **${payload.issue.title}**`,
			],
			author?.avatar_url,
		),
	);
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(`> ${truncate(payload.comment.body)}`));
	c.addActionRowComponents(linkRow(linkButton("View Comment", payload.comment.html_url)));
	return buildMessage([c]);
}
