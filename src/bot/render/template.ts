import type { AccentKey, IconKey } from "../../design/tokens.js";
import type { I18nText } from "../../i18n/index.js";

export const DISPLAY_MODES = ["detailed", "compact"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const DEFAULT_DISPLAY_MODE: DisplayMode = "detailed";

export function isDisplayMode(value: unknown): value is DisplayMode {
	return typeof value === "string" && (DISPLAY_MODES as readonly string[]).includes(value);
}

export interface TemplateField {
	label: I18nText;
	value: I18nText;
	/** Dropped in compact mode. */
	secondary?: boolean;
}

export interface TemplateLink {
	label: I18nText;
	url: string;
}

export interface TemplateImage {
	url: string;
	alt?: string;
}

/**
 * A locale-agnostic, builder-free description of one GitHub event. Payload
 * formatters return this; `renderTemplate` turns it into Components V2.
 */
export interface EventTemplate {
	accent: AccentKey;
	icon: IconKey;
	/** Headline, e.g. "Pull request merged". */
	title: I18nText;
	/** `owner/repo`. */
	repo: string;
	repoUrl?: string;
	/** Optional second line, e.g. "#42 · Add retry logic". */
	subtitle?: I18nText;
	/** Markdown block shown under the header in detailed mode. */
	body?: string;
	fields?: TemplateField[];
	/** Actor whose avatar becomes the section thumbnail. */
	actor?: { login: string; avatarUrl?: string; url?: string };
	images?: TemplateImage[];
	links?: TemplateLink[];
	timestamp?: Date;
	/** Drives how aggressively compact mode trims the message. */
	importance?: "low" | "normal" | "high";
	/** Overrides the repo language used by the `language` theme. */
	language?: string | null;
}
