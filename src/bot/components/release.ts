import type { ReleasePayload } from "../../github/payloads.js";
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

export function formatRelease(payload: ReleasePayload): FormattedMessage | null {
	if (payload.action !== "published") return null;

	const release = payload.release;
	const repo = payload.repository.full_name;
	const author = release.author ?? payload.sender;
	const tag = release.tag_name;
	const name = release.name?.trim();
	const assetCount = release.assets?.length ?? 0;

	const bodyLines: string[] = [`**${tag}**`];
	if (name && name !== tag) {
		bodyLines.push(name);
	}
	const meta: string[] = [];
	if (release.prerelease) meta.push("_Pre-release_");
	if (assetCount > 0) meta.push(`${assetCount} asset${assetCount === 1 ? "" : "s"}`);
	if (meta.length > 0) bodyLines.push(meta.join(" · "));

	const c = container(Accents.release);
	c.addSectionComponents(eventHeader(repo, "Release published", author?.avatar_url));
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(bodyLines.join("\n")));
	c.addActionRowComponents(linkRow(linkButton("View Release", release.html_url)));
	return buildMessage([c]);
}
