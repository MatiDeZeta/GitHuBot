import { Locale } from "discord.js";
import type { EventCategoryId, EventType } from "../config/events.js";
import { en } from "./locales/en.js";

export type TranslationKey = keyof typeof en;
export type TParams = Record<string, string | number>;

/** Base of any `<base>.one` / `<base>.other` pair, for `tp()`. */
export type PluralKey = {
	[K in TranslationKey]: K extends `${infer B}.other`
		? `${B}.one` extends TranslationKey
			? B
			: never
		: never;
}[TranslationKey];

export const DEFAULT_LOCALE = "en" as const;

/**
 * Locales that ship with GitHuBot. Adding one means creating
 * `locales/<code>.ts` exporting a `Partial<Catalog>` and listing it here plus
 * in `CATALOGS` and `DISCORD_LOCALE_MAP`.
 */
export const SUPPORTED_LOCALES = ["en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export type Catalog = Record<TranslationKey, string>;
export type PartialCatalog = Partial<Catalog>;

const CATALOGS: Record<AppLocale, PartialCatalog> = {
	en,
};

/** Maps Discord's locale codes onto the locales we actually have. */
const DISCORD_LOCALE_MAP: Partial<Record<Locale, AppLocale>> = {
	[Locale.EnglishUS]: "en",
	[Locale.EnglishGB]: "en",
};

export function isAppLocale(value: unknown): value is AppLocale {
	return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Guild preference wins, then the requester's Discord locale, then the
 * instance default. Unknown values silently fall back rather than throwing.
 */
export function resolveLocale(
	guildLocale: string | null | undefined,
	discordLocale?: string | null,
	fallback: string = DEFAULT_LOCALE,
): AppLocale {
	if (isAppLocale(guildLocale)) return guildLocale;
	if (discordLocale) {
		const mapped = DISCORD_LOCALE_MAP[discordLocale as Locale];
		if (mapped) return mapped;
		const short = discordLocale.split("-")[0];
		if (isAppLocale(short)) return short;
	}
	if (isAppLocale(fallback)) return fallback;
	return DEFAULT_LOCALE;
}

function interpolate(template: string, params?: TParams): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}

export function t(locale: AppLocale | undefined, key: TranslationKey, params?: TParams): string {
	const catalog = locale ? CATALOGS[locale] : undefined;
	const template = catalog?.[key] ?? en[key];
	return interpolate(template, params);
}

/** Plural-aware lookup: picks `<base>.one` when `count === 1`, else `<base>.other`. */
export function tp(
	locale: AppLocale | undefined,
	base: PluralKey,
	count: number,
	params?: TParams,
): string {
	const key = (count === 1 ? `${base}.one` : `${base}.other`) as TranslationKey;
	return t(locale, key, { count, ...params });
}

/**
 * A string that can be resolved lazily, so payload formatters stay pure and
 * locale-agnostic while still producing translatable output.
 */
export type I18nText = string | { key: TranslationKey; params?: TParams };

export function tx(key: TranslationKey, params?: TParams): I18nText {
	return params ? { key, params } : { key };
}

export function resolveText(locale: AppLocale | undefined, value: I18nText): string {
	return typeof value === "string" ? value : t(locale, value.key, value.params);
}

export function eventLabel(locale: AppLocale | undefined, event: EventType): string {
	return t(locale, `event.${event}.label` as TranslationKey);
}

export function eventDescription(locale: AppLocale | undefined, event: EventType): string {
	return t(locale, `event.${event}.description` as TranslationKey);
}

export function categoryLabel(locale: AppLocale | undefined, category: EventCategoryId): string {
	return t(locale, `category.${category}.label` as TranslationKey);
}

export function categoryDescription(
	locale: AppLocale | undefined,
	category: EventCategoryId,
): string {
	return t(locale, `category.${category}.description` as TranslationKey);
}

/**
 * Localization map for slash command builders. Only locales other than the
 * default are emitted, since Discord uses the base value for everything else.
 */
export function localizations(key: TranslationKey): Partial<Record<Locale, string>> {
	const out: Partial<Record<Locale, string>> = {};
	for (const [discordLocale, appLocale] of Object.entries(DISCORD_LOCALE_MAP) as [
		Locale,
		AppLocale,
	][]) {
		if (appLocale === DEFAULT_LOCALE) continue;
		const value = CATALOGS[appLocale]?.[key];
		if (value) out[discordLocale] = value;
	}
	return out;
}

/* Compile-time guarantee that every event and category has picker strings. */
type RequiredEventKeys =
	| `event.${EventType}.label`
	| `event.${EventType}.description`
	| `category.${EventCategoryId}.label`
	| `category.${EventCategoryId}.description`;

type _AssertCatalogCoversEvents = RequiredEventKeys extends TranslationKey ? true : never;
const _assertCatalogCoversEvents: _AssertCatalogCoversEvents = true;
void _assertCatalogCoversEvents;
