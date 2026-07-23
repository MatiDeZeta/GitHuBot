import type { IssuesPayload } from "../../github/payloads.js";
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

export function formatIssues(payload: IssuesPayload): FormattedMessage | null {
	const { action, issue } = payload;
	if (!["opened", "closed", "reopened"].includes(action)) return null;

	const accent =
		action === "closed" ? Accents.issueClosed : Accents.issueOpen;
	const headline =
		action === "opened"
			? "Issue opened"
			: action === "closed"
				? "Issue closed"
				: "Issue reopened";

	const repo = payload.repository.full_name;
	const author = issue.user ?? payload.sender;

	const c = container(accent);
	c.addSectionComponents(
		authorSection(
			[
				`**${repo}**`,
				`${headline} · [#${issue.number}](${issue.html_url})`,
				`**${issue.title}**`,
			],
			author?.avatar_url,
		),
	);

	if (issue.body) {
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(text(`> ${truncate(issue.body)}`));
	}

	c.addActionRowComponents(linkRow(linkButton("View Issue", issue.html_url)));
	return buildMessage([c]);
}
