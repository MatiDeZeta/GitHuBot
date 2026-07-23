import type { CreateDeletePayload } from "../../github/payloads.js";
import { Accents } from "./design.js";
import {
	authorSection,
	buildMessage,
	container,
	linkButton,
	linkRow,
	type FormattedMessage,
} from "./shared.js";

export function formatCreate(payload: CreateDeletePayload): FormattedMessage {
	const repo = payload.repository.full_name;
	const kind = payload.ref_type;
	const c = container(Accents.create);
	c.addSectionComponents(
		authorSection(
			[`**${repo}**`, `${kind} created · \`${payload.ref}\``],
			payload.sender?.avatar_url,
		),
	);
	c.addActionRowComponents(linkRow(linkButton("View Repository", payload.repository.html_url)));
	return buildMessage([c]);
}

export function formatDelete(payload: CreateDeletePayload): FormattedMessage {
	const repo = payload.repository.full_name;
	const kind = payload.ref_type;
	const c = container(Accents.delete);
	c.addSectionComponents(
		authorSection(
			[`**${repo}**`, `${kind} deleted · \`${payload.ref}\``],
			payload.sender?.avatar_url,
		),
	);
	c.addActionRowComponents(linkRow(linkButton("View Repository", payload.repository.html_url)));
	return buildMessage([c]);
}
