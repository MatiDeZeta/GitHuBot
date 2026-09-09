import {
	ActionRowBuilder,
	type APIMessageTopLevelComponent,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	type JSONEncodable,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";

export type V2Component = JSONEncodable<APIMessageTopLevelComponent>;

export interface FormattedMessage {
	components: V2Component[];
	flags: typeof MessageFlags.IsComponentsV2;
}

export const FALLBACK_AVATAR =
	"https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png";

/** Discord rejects messages above these limits outright. */
export const MAX_COMPONENTS = 40;
export const MAX_TEXT_CHARS = 4000;
/** A Section accepts at most three text displays. */
export const MAX_SECTION_TEXTS = 3;
/** A single action row fits five buttons. */
export const MAX_ROW_BUTTONS = 5;

export function text(content: string): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(content);
}

export function separator(divider = true, large = false): SeparatorBuilder {
	return new SeparatorBuilder()
		.setDivider(divider)
		.setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

export function linkButton(label: string, url: string): ButtonBuilder {
	return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(truncate(label, 80)).setURL(url);
}

export function row<T extends ButtonBuilder>(...buttons: T[]): ActionRowBuilder<T> {
	return new ActionRowBuilder<T>().addComponents(...buttons.slice(0, MAX_ROW_BUTTONS));
}

/** A Section must carry an accessory, so callers always get a thumbnail. */
export function thumbnailSection(lines: string[], thumbnailUrl?: string): SectionBuilder {
	const section = new SectionBuilder();
	for (const line of lines.slice(0, MAX_SECTION_TEXTS)) {
		section.addTextDisplayComponents(text(line));
	}
	section.setThumbnailAccessory(
		new ThumbnailBuilder().setURL(safeImageUrl(thumbnailUrl) ?? FALLBACK_AVATAR),
	);
	return section;
}

export function mediaGallery(items: { url: string; alt?: string }[]): MediaGalleryBuilder {
	const gallery = new MediaGalleryBuilder();
	for (const item of items.slice(0, 10)) {
		const builder = new MediaGalleryItemBuilder().setURL(item.url);
		if (item.alt) builder.setDescription(truncate(item.alt, 256));
		gallery.addItems(builder);
	}
	return gallery;
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

/** `<t:unix:R>` renders in each viewer's own timezone and language. */
export function relativeTime(date: Date): string {
	return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

export function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	if (max <= 1) return value.slice(0, max);
	return `${value.slice(0, max - 1)}…`;
}

/** Collapses a multi-line body into a single line, for compact mode. */
export function firstLine(value: string): string {
	const line = value.split(/\r?\n/).find((candidate) => candidate.trim().length > 0);
	return line?.trim() ?? "";
}

/**
 * Zero-width and bidi-override characters render as nothing but let a crafted GitHub
 * login or title visually impersonate another one.
 */
const INVISIBLE_CHARS = /[­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

export function stripInvisible(value: string): string {
	return value.replace(INVISIBLE_CHARS, "");
}

/** Escapes Discord markdown so issue titles cannot break the layout. */
export function escapeMarkdown(value: string): string {
	return stripInvisible(value).replace(/([*_`~|\\>])/g, "\\$1");
}

/**
 * Bodies keep most formatting (code blocks, emphasis) because that is the point of
 * quoting them. Two constructs are escaped: `[label](url)`, which lets untrusted text
 * put attacker-chosen words on an attacker-chosen link, and a leading `#`, which
 * renders as a heading even inside a blockquote and can impersonate our own headings.
 */
export function neutralizeBodyMarkdown(value: string): string {
	return stripInvisible(value)
		.replace(/([[\]])/g, "\\$1")
		.replace(/^(\s*)(#{1,3})(\s)/gm, "$1\\$2$3");
}

/** Only http(s) URLs are accepted by Discord's media components. */
export function safeImageUrl(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	return /^https?:\/\//i.test(url) ? url : undefined;
}

export function safeLinkUrl(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	return /^https?:\/\//i.test(url) ? url : undefined;
}
