import type { PullRequestPayload } from "../../github/payloads.js";
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

export function formatPullRequest(payload: PullRequestPayload): FormattedMessage | null {
	const pr = payload.pull_request;
	const merged = pr.merged === true;
	const action = payload.action;

	let accent: number = Accents.prOpen;
	let headline = "Pull request updated";

	if (action === "opened" || action === "reopened") {
		accent = Accents.prOpen;
		headline = action === "opened" ? "Pull request opened" : "Pull request reopened";
	} else if (action === "closed" && merged) {
		accent = Accents.prMerged;
		headline = "Pull request merged";
	} else if (action === "closed") {
		accent = Accents.prClosed;
		headline = "Pull request closed";
	} else if (action === "synchronize" || action === "edited" || action === "ready_for_review") {
		return null;
	} else {
		return null;
	}

	const repo = payload.repository.full_name;
	const author = pr.user ?? payload.sender;
	const base = pr.base?.ref;
	const head = pr.head?.ref;
	const branchLine =
		base && head ? `\`${head}\` → \`${base}\`` : undefined;

	const c = container(accent);
	c.addSectionComponents(
		authorSection(
			[
				`**${repo}**`,
				`${headline} · [#${payload.number}](${pr.html_url})`,
				`**${pr.title}**`,
			],
			author?.avatar_url,
		),
	);

	if (branchLine || pr.body) {
		c.addSeparatorComponents(separator());
		const parts: string[] = [];
		if (branchLine) parts.push(branchLine);
		if (pr.body) parts.push(`> ${truncate(pr.body)}`);
		c.addTextDisplayComponents(text(parts.join("\n")));
	}

	c.addActionRowComponents(linkRow(linkButton("View Pull Request", pr.html_url)));
	return buildMessage([c]);
}
