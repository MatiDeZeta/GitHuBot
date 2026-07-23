import type { PullRequestPayload } from "../../github/payloads.js";
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
	const branchLine = base && head ? `\`${head}\` → \`${base}\`` : undefined;

	const bodyParts: string[] = [
		`**${pr.title}**`,
		`[#${payload.number}](${pr.html_url})`,
	];
	if (branchLine) bodyParts.push(branchLine);
	if (pr.body) bodyParts.push(`> ${truncate(pr.body)}`);

	const c = container(accent);
	c.addSectionComponents(eventHeader(repo, headline, author?.avatar_url));
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(bodyParts.join("\n")));
	c.addActionRowComponents(linkRow(linkButton("View Pull Request", pr.html_url)));
	return buildMessage([c]);
}
