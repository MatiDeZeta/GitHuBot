import type { ForkPayload } from "../../github/payloads.js";
import { Accents } from "./design.js";
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

export function formatFork(payload: ForkPayload): FormattedMessage {
	const repo = payload.repository.full_name;
	const forkee = payload.forkee;
	const author = forkee.owner ?? payload.sender;

	const c = container(Accents.fork);
	c.addSectionComponents(eventHeader(repo, "Repository forked", author?.avatar_url));
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(`**${forkee.full_name}**`));
	c.addActionRowComponents(
		linkRow(
			linkButton("View Fork", forkee.html_url),
			linkButton("View Source", payload.repository.html_url),
		),
	);
	return buildMessage([c]);
}
