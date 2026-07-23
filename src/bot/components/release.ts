import type { ReleasePayload } from "../../github/payloads.js";
import { Accents, truncate } from "./design.js";
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
	const name = release.name || release.tag_name;
	const assetCount = release.assets?.length ?? 0;

	const c = container(Accents.release);
	c.addSectionComponents(
		authorSection(
			[
				`**${repo}**`,
				`Release published · \`${release.tag_name}\``,
				`**${name}**`,
			],
			author?.avatar_url,
		),
	);

	const details: string[] = [];
	if (release.prerelease) details.push("_Pre-release_");
	details.push(`${assetCount} asset${assetCount === 1 ? "" : "s"}`);
	if (release.body) details.push(`> ${truncate(release.body)}`);

	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(text(details.join("\n")));
	c.addActionRowComponents(linkRow(linkButton("View Release", release.html_url)));
	return buildMessage([c]);
}
