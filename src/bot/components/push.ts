import type { PushPayload } from "../../github/payloads.js";
import {
	Accents,
	MAX_COMMITS_SHOWN,
	branchFromRef,
	firstLine,
	shortSha,
} from "./design.js";
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

export function formatPush(payload: PushPayload): FormattedMessage | null {
	const commits = payload.commits ?? [];
	// Empty pushes (common on tag create) are noise — create/delete covers those.
	if (commits.length === 0) {
		return null;
	}

	const branch = branchFromRef(payload.ref);
	const repo = payload.repository.full_name;
	const sender = payload.sender;
	const shown = commits.slice(0, MAX_COMMITS_SHOWN);
	const remaining = commits.length - shown.length;

	const commitLines = shown.map((c) => {
		const author =
			c.author?.username ?? c.author?.name ?? c.committer?.username ?? c.committer?.name ?? "unknown";
		const subject = firstLine(c.message);
		return `[\`${shortSha(c.id)}\`](${c.url}) **${subject}** — *${author}*`;
	});

	if (remaining > 0) {
		commitLines.push(`_…and ${remaining} more commit${remaining === 1 ? "" : "s"}_`);
	}

	const c = container(Accents.push);
	c.addSectionComponents(
		authorSection(
			[
				`**${repo}**`,
				`Push to \`${branch}\` · **${commits.length}** commit${commits.length === 1 ? "" : "s"}`,
			],
			sender?.avatar_url,
		),
	);
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(commitLines.join("\n")));

	const buttons = [];
	if (payload.compare) {
		buttons.push(linkButton("Compare", payload.compare));
	}
	const head = payload.head_commit ?? commits[0];
	if (head?.url) {
		buttons.push(linkButton("View Commit", head.url));
	}
	if (buttons.length > 0) {
		c.addActionRowComponents(linkRow(...buttons.slice(0, 5)));
	}

	return buildMessage([c]);
}
