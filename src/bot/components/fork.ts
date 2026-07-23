import type { ForkPayload } from "../../github/payloads.js";
import { Accents } from "./design.js";
import {
	authorSection,
	buildMessage,
	container,
	linkButton,
	linkRow,
	type FormattedMessage,
} from "./shared.js";

export function formatFork(payload: ForkPayload): FormattedMessage {
	const repo = payload.repository.full_name;
	const forkee = payload.forkee;
	const author = forkee.owner ?? payload.sender;

	const c = container(Accents.fork);
	c.addSectionComponents(
		authorSection(
			[`**${repo}**`, `Forked to **${forkee.full_name}**`],
			author?.avatar_url,
		),
	);
	c.addActionRowComponents(
		linkRow(
			linkButton("View Fork", forkee.html_url),
			linkButton("View Source", payload.repository.html_url),
		),
	);
	return buildMessage([c]);
}
