import type { ReleasePayload } from "../../github/payloads.js";
import { Accents, shortReleaseDescription } from "./design.js";
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

export function formatRelease(payload: ReleasePayload): FormattedMessage | null {
	if (payload.action !== "published") return null;

	const release = payload.release;
	const repo = payload.repository.full_name;
	const author = release.author ?? payload.sender;
	const tag = release.tag_name;
	const name = release.name?.trim();
	const title = name && name !== tag ? name : tag;
	const assetCount = release.assets?.length ?? 0;

	const c = container(Accents.release);
	c.addSectionComponents(
		authorSection(
			[
				`**${repo}**`,
				`Release published · \`${tag}\``,
				`**${title}**`,
			],
			author?.avatar_url,
		),
	);

	const details: string[] = [];
	if (release.prerelease) details.push("_Pre-release_");
	if (assetCount > 0) details.push(`${assetCount} asset${assetCount === 1 ? "" : "s"}`);
	if (release.body) {
		const blurb = shortReleaseDescription(release.body);
		if (blurb) details.push(`> ${blurb}`);
	}

	if (details.length > 0) {
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(text(details.join("\n")));
	}

	c.addActionRowComponents(linkRow(linkButton("View Release", release.html_url)));
	return buildMessage([c]);
}
