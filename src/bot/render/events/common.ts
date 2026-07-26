import type { Actor, Repository } from "../../../github/payloads.js";
import { tx, type I18nText } from "../../../i18n/index.js";
import { escapeMarkdown, truncate } from "../blocks.js";
import type { EventTemplate, TemplateLink } from "../template.js";

export interface RepoBits {
	repo: string;
	repoUrl: string;
	language?: string | null;
}

export function repoBits(repository: Repository): RepoBits {
	return {
		repo: repository.full_name,
		repoUrl: repository.html_url,
		language: repository.language ?? null,
	};
}

export function actorBits(actor: Actor | undefined): EventTemplate["actor"] {
	if (!actor) return undefined;
	return {
		login: actor.login,
		avatarUrl: actor.avatar_url,
		url: actor.html_url,
	};
}

/** `refs/heads/main` → `main`, `refs/tags/v1` → `v1`. */
export function shortRef(ref: string): string {
	return ref.replace(/^refs\/(heads|tags)\//, "");
}

export function code(value: string): string {
	return `\`${value.replace(/`/g, "ʼ")}\``;
}

/** Renders untrusted user text as a blockquote so it cannot fake headings. */
export function quote(body: string | null | undefined, max = 600): string | undefined {
	const trimmed = body?.trim();
	if (!trimmed) return undefined;
	const clipped = truncate(trimmed, max);
	return clipped
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");
}

export function titleText(value: string, max = 200): string {
	return escapeMarkdown(truncate(value.trim(), max));
}

export function numbered(number: number, title: string): I18nText {
	return `#${number} · ${titleText(title)}`;
}

export function parseDate(value: string | null | undefined): Date | undefined {
	if (!value) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

export function repositoryLink(bits: RepoBits): TemplateLink {
	return { label: tx("link.repository"), url: bits.repoUrl };
}

/** Drops links whose URL is missing, keeping formatter code branch-free. */
export function links(
	...candidates: (TemplateLink | { label: I18nText; url: string | null | undefined })[]
): TemplateLink[] {
	const out: TemplateLink[] = [];
	for (const candidate of candidates) {
		if (candidate.url) out.push({ label: candidate.label, url: candidate.url });
	}
	return out;
}

export function humanizeDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "—";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const restSeconds = seconds % 60;
	if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/** Turns `success`, `timed_out` etc. into `Success`, `Timed out`. */
export function humanizeState(value: string): string {
	const spaced = value.replace(/[_-]+/g, " ").trim();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
