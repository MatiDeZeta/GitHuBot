import type { PullRequestReviewPayload } from "../../github/payloads.js";
import { Accents, truncate } from "./design.js";
import {
	buildMessage,
	container,
	eventHeader,
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

	const bodyParts: string[] = [
		`**${payload.pull_request.title}**`,
		`[#${payload.pull_request.number}](${payload.pull_request.html_url})`,
	];
	if (payload.review.body) {
		bodyParts.push(`> ${truncate(payload.review.body)}`);
	}

	const c = container(Accents.review);
	c.addSectionComponents(
		eventHeader(repo, `Review ${stateLabel}`, author?.avatar_url),
	);
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(bodyParts.join("\n")));
	c.addActionRowComponents(linkRow(linkButton("View Review", payload.review.html_url)));
	return buildMessage([c]);
}
