import type { PullRequestReviewPayload } from "../../github/payloads.js";
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

export function formatPullRequestReview(
	payload: PullRequestReviewPayload,
): FormattedMessage | null {
	if (payload.action !== "submitted") return null;

	const state = payload.review.state.toLowerCase();
	const stateLabel =
		state === "approved"
			? "approved"
			: state === "changes_requested"
				? "requested changes"
				: "reviewed";

	const repo = payload.repository.full_name;
	const author = payload.review.user ?? payload.sender;

	const c = container(Accents.review);
	c.addSectionComponents(
		authorSection(
			[
				`**${repo}**`,
				`Review ${stateLabel} · [#${payload.pull_request.number}](${payload.pull_request.html_url})`,
				`**${payload.pull_request.title}**`,
			],
			author?.avatar_url,
		),
	);

	if (payload.review.body) {
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(text(`> ${truncate(payload.review.body)}`));
	}

	c.addActionRowComponents(linkRow(linkButton("View Review", payload.review.html_url)));
	return buildMessage([c]);
}
