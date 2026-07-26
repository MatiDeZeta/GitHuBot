import type { EventType } from "../config/events.js";
import type { DisplayMode } from "../bot/render/template.js";
import type { ThemeId } from "../bot/render/theme.js";
import type { AppLocale } from "../i18n/index.js";

export interface RepoFilters {
	/** Glob patterns; when non-empty only matching branches are delivered. */
	branchInclude: string[];
	/** Glob patterns that always win over `branchInclude`. */
	branchExclude: string[];
	/** When non-empty only issues/PRs carrying one of these labels pass. */
	labels: string[];
	/** Logins to drop. The literal `bot` matches every bot account. */
	ignoredActors: string[];
}

export const EMPTY_FILTERS: RepoFilters = {
	branchInclude: [],
	branchExclude: [],
	labels: [],
	ignoredActors: [],
};

export interface TrackedRepo {
	id: number;
	guildId: string;
	owner: string;
	repo: string;
	channelId: string;
	trackingId: string;
	encryptedSecret: string;
	encryptedPreviousSecret: string | null;
	enabledEvents: EventType[];

	paused: boolean;
	displayMode: DisplayMode | null;
	theme: ThemeId | null;
	locale: AppLocale | null;

	filters: RepoFilters;
	/** Per-event channel overrides, keyed by event type. */
	eventRoutes: Record<string, string>;
	/** Per-event role pings, keyed by event type. */
	mentionRules: Record<string, string[]>;

	lastDeliveryAt: Date | null;
	lastSuccessAt: Date | null;
	lastErrorAt: Date | null;
	lastError: string | null;
	deliveredCount: number;
	failedCount: number;

	createdAt: Date;
	updatedAt: Date;
}

export interface GuildSettings {
	guildId: string;
	locale: AppLocale | null;
	defaultTheme: ThemeId | null;
	defaultDisplayMode: DisplayMode | null;
}

export interface CreateTrackedRepoInput {
	guildId: string;
	owner: string;
	repo: string;
	channelId: string;
	trackingId: string;
	encryptedSecret: string;
	enabledEvents: EventType[];
}

export interface RotateSecretInput {
	guildId: string;
	owner: string;
	repo: string;
	/** New current secret (encrypted). */
	encryptedSecret: string;
	/** Previous current secret retained for verifyWithFallback. */
	encryptedPreviousSecret: string;
}

export interface RepoStyleInput {
	theme?: ThemeId | null;
	displayMode?: DisplayMode | null;
	locale?: AppLocale | null;
}

export interface DeliveryResult {
	trackingId: string;
	success: boolean;
	/** Recorded verbatim on failure so `/repo health` can surface it. */
	error?: string;
}

export interface RepoRepository {
	ensureGuild(guildId: string): Promise<void>;
	getGuildSettings(guildId: string): Promise<GuildSettings | null>;
	updateGuildSettings(
		guildId: string,
		settings: Partial<Omit<GuildSettings, "guildId">>,
	): Promise<void>;

	addRepo(input: CreateTrackedRepoInput): Promise<TrackedRepo>;
	removeRepo(guildId: string, owner: string, repo: string): Promise<TrackedRepo | null>;
	listRepos(guildId: string): Promise<TrackedRepo[]>;
	/** Global count of tracked repos across all guilds (for bot presence). */
	countTrackedRepos(): Promise<number>;
	getRepo(guildId: string, owner: string, repo: string): Promise<TrackedRepo | null>;
	findByTrackingId(trackingId: string): Promise<TrackedRepo | null>;

	updateChannel(
		guildId: string,
		owner: string,
		repo: string,
		channelId: string,
	): Promise<TrackedRepo | null>;
	updateEvents(
		guildId: string,
		owner: string,
		repo: string,
		enabledEvents: EventType[],
	): Promise<TrackedRepo | null>;
	setPaused(
		guildId: string,
		owner: string,
		repo: string,
		paused: boolean,
	): Promise<TrackedRepo | null>;
	updateStyle(
		guildId: string,
		owner: string,
		repo: string,
		style: RepoStyleInput,
	): Promise<TrackedRepo | null>;
	updateFilters(
		guildId: string,
		owner: string,
		repo: string,
		filters: RepoFilters,
	): Promise<TrackedRepo | null>;
	updateRoutes(
		guildId: string,
		owner: string,
		repo: string,
		routes: Record<string, string>,
	): Promise<TrackedRepo | null>;
	updateMentions(
		guildId: string,
		owner: string,
		repo: string,
		mentions: Record<string, string[]>,
	): Promise<TrackedRepo | null>;

	/** Rotate secret: new becomes current, old current becomes previous (fallback). */
	rotateSecret(input: RotateSecretInput): Promise<TrackedRepo | null>;
	/** Drop the previous secret after the new one is confirmed in use. */
	clearPreviousSecret(trackingId: string): Promise<void>;
	/** Returns true if this delivery is new and was recorded; false if duplicate. */
	tryRecordDelivery(deliveryId: string, trackingId: string): Promise<boolean>;
	/** Updates the health counters shown by `/repo health` and `/repo list`. */
	recordDeliveryResult(result: DeliveryResult): Promise<void>;
}
