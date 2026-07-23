import type { StarPayload } from "../../github/payloads.js";
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

export function formatStar(payload: StarPayload): FormattedMessage | null {
	if (payload.action !== "started") return null;

	const repo = payload.repository.full_name;
	const who = payload.sender?.login ?? "someone";
	const c = container(Accents.star);
	c.addSectionComponents(eventHeader(repo, "New star", payload.sender?.avatar_url));
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(`**${who}** starred this repository`));
	c.addActionRowComponents(linkRow(linkButton("View Repository", payload.repository.html_url)));
	return buildMessage([c]);
}
