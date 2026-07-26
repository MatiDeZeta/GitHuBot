import type { EventType } from "../../config/events.js";
import type { FormattedMessage } from "../render/blocks.js";
import { buildEventTemplate } from "../render/events/index.js";
import { renderTemplate, type RenderOptions } from "../render/render.js";
import { DEFAULT_DISPLAY_MODE } from "../render/template.js";
import { DEFAULT_THEME } from "../render/theme.js";
import { DEFAULT_LOCALE } from "../../i18n/index.js";

export type { FormattedMessage } from "../render/blocks.js";
export type { RenderOptions } from "../render/render.js";

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
	theme: DEFAULT_THEME,
	mode: DEFAULT_DISPLAY_MODE,
	locale: DEFAULT_LOCALE,
};

/**
 * Turns a raw GitHub webhook body into a Components V2 message.
 * Returns null when the event carries nothing worth posting.
 */
export function formatGitHubEvent(
	eventType: EventType,
	payload: unknown,
	options: RenderOptions = DEFAULT_RENDER_OPTIONS,
): FormattedMessage | null {
	const template = buildEventTemplate(eventType, payload);
	if (!template) return null;
	return renderTemplate(template, options);
}
