import type { CreateDeletePayload } from "../../github/payloads.js";
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

export function formatCreate(payload: CreateDeletePayload): FormattedMessage {
	const repo = payload.repository.full_name;
	const kind = payload.ref_type;
	const c = container(Accents.create);
	c.addSectionComponents(eventHeader(repo, `${kind} created`, payload.sender?.avatar_url));
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(`**\`${payload.ref}\`**`));
	c.addActionRowComponents(linkRow(linkButton("View Repository", payload.repository.html_url)));
	return buildMessage([c]);
}

export function formatDelete(payload: CreateDeletePayload): FormattedMessage {
	const repo = payload.repository.full_name;
	const kind = payload.ref_type;
	const c = container(Accents.delete);
	c.addSectionComponents(eventHeader(repo, `${kind} deleted`, payload.sender?.avatar_url));
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(`**\`${payload.ref}\`**`));
	c.addActionRowComponents(linkRow(linkButton("View Repository", payload.repository.html_url)));
	return buildMessage([c]);
}
