import type { RenderOptions } from "../bot/render/render.js";
import { sampleTemplate } from "../bot/render/samples.js";
import type { EventTemplate } from "../bot/render/template.js";
import { resolveAccent } from "../bot/render/theme.js";
import { type I18nText, resolveText } from "../i18n/index.js";
import { escapeHtml } from "./html.js";

/** A merge and a failed run: how the theme tells good news from bad. */
const PREVIEW_EVENTS = ["pull_request", "workflow_run"] as const;

const BODY_LIMIT = 260;

/**
 * Sample messages drawn the way Discord lays them out, so a theme or density can
 * be judged before it is saved. Built from the same templates real deliveries
 * use; only the final Discord-components step is replaced by HTML.
 */
export function previewMessages(options: RenderOptions, repo: string, login: string): string {
	const cards = PREVIEW_EVENTS.map((event) =>
		card(sampleTemplate(event, repo, `https://github.com/${repo}`, { login }), options),
	).join("");
	return `<div class="msgs">${cards}</div>`;
}

function card(template: EventTemplate, options: RenderOptions): string {
	const text = (value: I18nText) => resolveText(options.locale, value);
	const accent = resolveAccent(template.accent, {
		theme: options.theme,
		language: template.language,
	});
	const detailed = options.mode === "detailed";

	const meta = [
		`<code>${escapeHtml(template.repo)}</code>`,
		...(template.badge ?? []).map((part) => markdown(text(part))),
	].join(" · ");

	const body = template.body
		? (Array.isArray(template.body) ? template.body : [template.body]).map(text).join("\n")
		: "";
	const fields = (template.fields ?? []).filter((field) => detailed || !field.secondary);

	return `<div class="msg">
		<svg class="bar" width="4" height="40" preserveAspectRatio="none" viewBox="0 0 4 40" aria-hidden="true"><rect width="4" height="40" fill="${hex(accent)}"/></svg>
		<div class="in">
			<div class="ti">${markdown(text(template.title))}</div>
			${template.subtitle ? `<div>${markdown(text(template.subtitle))}</div>` : ""}
			<div class="mt">${meta}</div>
			${detailed && body ? `<div>${markdown(clip(body))}</div>` : ""}
			${
				detailed && fields.length > 0
					? `<div class="fl">${fields
							.slice(0, 6)
							.map(
								(field) =>
									`<div><b>${escapeHtml(text(field.label))}</b>${markdown(text(field.value))}</div>`,
							)
							.join("")}</div>`
					: ""
			}
			${
				template.links && template.links.length > 0
					? `<div class="bt">${template.links
							.slice(0, 3)
							.map((link) => `<span>${escapeHtml(text(link.label))}</span>`)
							.join("")}</div>`
					: ""
			}
		</div>
	</div>`;
}

function hex(color: number): string {
	return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function clip(value: string): string {
	return value.length > BODY_LIMIT ? `${value.slice(0, BODY_LIMIT - 1)}…` : value;
}

/**
 * Just enough Discord markdown for sample text. Escaped first, so nothing here can
 * introduce markup; links keep their label and drop the target.
 */
function markdown(value: string): string {
	return escapeHtml(value)
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/^-# /gm, "")
		.replace(/^&gt; /gm, "")
		.replace(/\\([\\*_`~|#>[\]()-])/g, "$1")
		.replace(/\n/g, "<br>");
}
