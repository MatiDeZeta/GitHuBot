import { isDisplayMode, type DisplayMode } from "../bot/render/template.js";
import { isThemeId, type ThemeId } from "../bot/render/theme.js";
import { parseEnabledEvents } from "../config/events.js";
import { isAppLocale, type AppLocale } from "../i18n/index.js";
import type { GuildSettings, RepoFilters, TrackedRepo } from "./types.js";

/**
 * Structural shape shared by the SQLite and Postgres row types, so both
 * repositories can reuse a single mapper.
 */
export interface RawRepoRow {
	id: number;
	guildId: string;
	owner: string;
	repo: string;
	channelId: string;
	trackingId: string;
	encryptedSecret: string;
	encryptedPreviousSecret: string | null;
	enabledEvents: unknown;
	paused: boolean;
	displayMode: string | null;
	theme: string | null;
	locale: string | null;
	branchInclude: unknown;
	branchExclude: unknown;
	labelFilter: unknown;
	ignoredActors: unknown;
	eventRoutes: unknown;
	mentionRules: unknown;
	lastDeliveryAt: Date | null;
	lastSuccessAt: Date | null;
	lastErrorAt: Date | null;
	lastError: string | null;
	deliveredCount: number;
	failedCount: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface RawGuildRow {
	guildId: string;
	locale: string | null;
	defaultTheme: string | null;
	defaultDisplayMode: string | null;
}

/** JSON columns can hold legacy text, so every read is defensive. */
function stringArray(raw: unknown): string[] {
	if (typeof raw === "string") {
		try {
			return stringArray(JSON.parse(raw));
		} catch {
			return [];
		}
	}
	if (!Array.isArray(raw)) return [];
	return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function stringRecord(raw: unknown): Record<string, string> {
	if (typeof raw === "string") {
		try {
			return stringRecord(JSON.parse(raw));
		} catch {
			return {};
		}
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === "string" && value.length > 0) out[key] = value;
	}
	return out;
}

function stringArrayRecord(raw: unknown): Record<string, string[]> {
	if (typeof raw === "string") {
		try {
			return stringArrayRecord(JSON.parse(raw));
		} catch {
			return {};
		}
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const list = stringArray(value);
		if (list.length > 0) out[key] = list;
	}
	return out;
}

function asTheme(value: string | null): ThemeId | null {
	return isThemeId(value) ? value : null;
}

function asDisplayMode(value: string | null): DisplayMode | null {
	return isDisplayMode(value) ? value : null;
}

function asLocale(value: string | null): AppLocale | null {
	return isAppLocale(value) ? value : null;
}

export function mapRepoRow(row: RawRepoRow): TrackedRepo {
	const filters: RepoFilters = {
		branchInclude: stringArray(row.branchInclude),
		branchExclude: stringArray(row.branchExclude),
		labels: stringArray(row.labelFilter),
		ignoredActors: stringArray(row.ignoredActors),
	};

	return {
		id: row.id,
		guildId: row.guildId,
		owner: row.owner,
		repo: row.repo,
		channelId: row.channelId,
		trackingId: row.trackingId,
		encryptedSecret: row.encryptedSecret,
		encryptedPreviousSecret: row.encryptedPreviousSecret ?? null,
		enabledEvents: parseEnabledEvents(row.enabledEvents),
		paused: Boolean(row.paused),
		displayMode: asDisplayMode(row.displayMode),
		theme: asTheme(row.theme),
		locale: asLocale(row.locale),
		filters,
		eventRoutes: stringRecord(row.eventRoutes),
		mentionRules: stringArrayRecord(row.mentionRules),
		lastDeliveryAt: row.lastDeliveryAt ?? null,
		lastSuccessAt: row.lastSuccessAt ?? null,
		lastErrorAt: row.lastErrorAt ?? null,
		lastError: row.lastError ?? null,
		deliveredCount: row.deliveredCount ?? 0,
		failedCount: row.failedCount ?? 0,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function mapGuildRow(row: RawGuildRow): GuildSettings {
	return {
		guildId: row.guildId,
		locale: asLocale(row.locale),
		defaultTheme: asTheme(row.defaultTheme),
		defaultDisplayMode: asDisplayMode(row.defaultDisplayMode),
	};
}

/** Truncated so a giant Discord error never bloats the row. */
export function clampError(message: string | undefined): string | null {
	if (!message) return null;
	return message.length > 500 ? `${message.slice(0, 499)}…` : message;
}
