import type { ButtonBuilder } from "discord.js";
import { type AppLocale, resolveText, t } from "../../i18n/index.js";
import {
	buildMessage,
	container,
	escapeMarkdown,
	type FormattedMessage,
	firstLine,
	linkButton,
	MAX_ROW_BUTTONS,
	MAX_TEXT_CHARS,
	mediaGallery,
	relativeTime,
	row,
	safeImageUrl,
	safeLinkUrl,
	separator,
	text,
	thumbnailSection,
	truncate,
} from "./blocks.js";
import { icon } from "./icons.js";
import type { DisplayMode, EventTemplate } from "./template.js";
import { resolveAccent, type ThemeId } from "./theme.js";

export interface RenderOptions {
	theme: ThemeId;
	mode: DisplayMode;
	locale: AppLocale;
}

/** Per-section character ceilings, kept well inside the 4000 char message cap. */
const HEADER_BUDGET = 400;
const BODY_BUDGET = 1400;
const FIELDS_BUDGET = 1200;
const COMPACT_BODY_BUDGET = 220;

export function renderTemplate(tpl: EventTemplate, opts: RenderOptions): FormattedMessage {
	const accent = resolveAccent(tpl.accent, {
		theme: opts.theme,
		language: tpl.language,
	});
	const c = container(accent);
	const glyph = icon(tpl.icon);
	const title = resolveText(opts.locale, tpl.title);
	const subtitle = tpl.subtitle ? resolveText(opts.locale, tpl.subtitle) : undefined;
	const repoLink = tpl.repoUrl ? `[\`${tpl.repo}\`](${tpl.repoUrl})` : `\`${tpl.repo}\``;

	if (opts.mode === "compact") {
		return renderCompact(c, tpl, opts, { glyph, title, subtitle, repoLink });
	}
	return renderDetailed(c, tpl, opts, { glyph, title, subtitle, repoLink });
}

interface HeaderParts {
	glyph: string;
	title: string;
	subtitle: string | undefined;
	repoLink: string;
}

function renderDetailed(
	c: ReturnType<typeof container>,
	tpl: EventTemplate,
	opts: RenderOptions,
	parts: HeaderParts,
): FormattedMessage {
	const headerLines: string[] = [`### ${parts.glyph} ${parts.title}`, parts.repoLink];
	if (parts.subtitle) headerLines[1] = `${parts.repoLink} · ${parts.subtitle}`;

	const meta = metaLine(tpl, opts.locale);
	if (meta) headerLines.push(meta);

	c.addSectionComponents(
		thumbnailSection(
			headerLines.map((line) => truncate(line, HEADER_BUDGET)),
			tpl.actor?.avatarUrl,
			avatarAlt(tpl, opts.locale),
		),
	);

	let remaining = MAX_TEXT_CHARS - headerLines.join("\n").length;

	// One divider under the header, whichever of badge, body and fields come first.
	let divided = false;
	const addBlock = (content: string) => {
		if (!divided) c.addSeparatorComponents(separator());
		divided = true;
		c.addTextDisplayComponents(text(content));
		remaining -= content.length;
	};

	const badge = badgeText(tpl, opts.locale);
	if (badge) addBlock(truncate(badge, HEADER_BUDGET));

	const body = bodyText(tpl, opts.locale);
	if (body) {
		const rendered = truncate(body, Math.min(BODY_BUDGET, Math.max(remaining - 200, 0)));
		if (rendered) addBlock(rendered);
	}

	const fieldLines = (tpl.fields ?? [])
		.map(
			(field) =>
				`**${resolveText(opts.locale, field.label)}:** ${resolveText(opts.locale, field.value)}`,
		)
		.filter((line) => line.length > 0);

	if (fieldLines.length > 0) {
		const rendered = truncate(
			fieldLines.join("\n"),
			Math.min(FIELDS_BUDGET, Math.max(remaining - 100, 0)),
		);
		if (rendered) addBlock(rendered);
	}

	const images = (tpl.images ?? [])
		.flatMap((image) => {
			const url = safeImageUrl(image.url);
			return url ? [{ url, ...(image.alt ? { alt: image.alt } : {}) }] : [];
		})
		.slice(0, 4);
	if (images.length > 0) {
		c.addMediaGalleryComponents(mediaGallery(images));
	}

	const buttons = linkButtons(tpl, opts.locale, MAX_ROW_BUTTONS);
	if (buttons.length > 0) {
		c.addSeparatorComponents(separator(false));
		c.addActionRowComponents(row(...buttons));
	}

	return buildMessage([c]);
}

function renderCompact(
	c: ReturnType<typeof container>,
	tpl: EventTemplate,
	opts: RenderOptions,
	parts: HeaderParts,
): FormattedMessage {
	const head = `${parts.glyph} **${parts.title}** · ${parts.repoLink}`;
	const lines = [truncate(head, HEADER_BUDGET)];

	const body = bodyText(tpl, opts.locale);
	const detail = [badgeText(tpl, opts.locale), parts.subtitle, body ? firstLine(body) : undefined]
		.filter((value): value is string => Boolean(value && value.length > 0))
		.join(" — ");
	if (detail) lines.push(truncate(detail, COMPACT_BODY_BUDGET));

	const meta = metaLine(tpl, opts.locale);
	if (meta) lines.push(meta);

	c.addSectionComponents(
		thumbnailSection(lines, tpl.actor?.avatarUrl, avatarAlt(tpl, opts.locale)),
	);

	const buttons = linkButtons(tpl, opts.locale, 3);
	if (buttons.length > 0) {
		c.addActionRowComponents(row(...buttons));
	}

	return buildMessage([c]);
}

function avatarAlt(tpl: EventTemplate, locale: AppLocale): string | undefined {
	return tpl.actor?.login ? t(locale, "common.avatarOf", { user: tpl.actor.login }) : undefined;
}

function badgeText(tpl: EventTemplate, locale: AppLocale): string | undefined {
	const parts = (tpl.badge ?? []).map((part) => resolveText(locale, part)).filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function bodyText(tpl: EventTemplate, locale: AppLocale): string | undefined {
	if (tpl.body === undefined) return undefined;
	const lines = Array.isArray(tpl.body) ? tpl.body : [tpl.body];
	const text = lines
		.map((line) => resolveText(locale, line))
		.join("\n")
		.trim();
	return text || undefined;
}

function metaLine(tpl: EventTemplate, locale: AppLocale): string | undefined {
	const pieces: string[] = [];
	if (tpl.actor?.login) {
		const name = escapeMarkdown(tpl.actor.login);
		pieces.push(
			t(locale, "common.by", {
				user: tpl.actor.url ? `[${name}](${tpl.actor.url})` : name,
			}),
		);
	}
	if (tpl.timestamp) pieces.push(relativeTime(tpl.timestamp));
	if (pieces.length === 0) return undefined;
	return `-# ${pieces.join(" · ")}`;
}

function linkButtons(tpl: EventTemplate, locale: AppLocale, max: number): ButtonBuilder[] {
	const seen = new Set<string>();
	const buttons: ButtonBuilder[] = [];
	for (const link of tpl.links ?? []) {
		const url = safeLinkUrl(link.url);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		buttons.push(linkButton(resolveText(locale, link.label), url));
		if (buttons.length >= max) break;
	}
	return buttons;
}
