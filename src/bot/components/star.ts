import type { StarPayload } from "../../github/payloads.js";
import { Accents } from "./design.js";
import {
	authorSection,
	buildMessage,
	container,
	linkButton,
	linkRow,
	type FormattedMessage,
} from "./shared.js";

export function formatStar(payload: StarPayload): FormattedMessage | null {
	if (payload.action !== "started") return null;

	const repo = payload.repository.full_name;
	const c = container(Accents.star);
	c.addSectionComponents(
		authorSection(
			[`**${repo}**`, `Starred by **${payload.sender?.login ?? "someone"}**`],
			payload.sender?.avatar_url,
		),
	);
	c.addActionRowComponents(linkRow(linkButton("View Repository", payload.repository.html_url)));
	return buildMessage([c]);
}
