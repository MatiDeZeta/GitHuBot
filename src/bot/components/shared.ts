import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
	type APIMessageTopLevelComponent,
	type JSONEncodable,
} from "discord.js";

export type V2Component = JSONEncodable<APIMessageTopLevelComponent>;

export interface FormattedMessage {
	components: V2Component[];
	flags: typeof MessageFlags.IsComponentsV2;
}

const FALLBACK_AVATAR = "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png";

export function v2Flags(): typeof MessageFlags.IsComponentsV2 {
	return MessageFlags.IsComponentsV2;
}

export function text(content: string): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(content);
}

export function separator(divider = true): SeparatorBuilder {
	return new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);
}

export function linkButton(label: string, url: string): ButtonBuilder {
	return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
}

export function linkRow(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

/** Section requires an accessory — always attach a thumbnail (fallback to GitHub mark). */
export function authorSection(
	lines: string[],
	avatarUrl: string | undefined,
): SectionBuilder {
	const section = new SectionBuilder();
	for (const line of lines) {
		section.addTextDisplayComponents(text(line));
	}
	section.setThumbnailAccessory(
		new ThumbnailBuilder().setURL(avatarUrl || FALLBACK_AVATAR),
	);
	return section;
}

export function container(accent: number): ContainerBuilder {
	return new ContainerBuilder().setAccentColor(accent);
}

export function buildMessage(parts: V2Component[]): FormattedMessage {
	return {
		components: parts,
		flags: MessageFlags.IsComponentsV2,
	};
}
