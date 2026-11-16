import type { DisplayMode } from "../bot/render/template.js";
import type { ThemeId } from "../bot/render/theme.js";
import type { EventType } from "../config/events.js";
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
	/**
	 * The `owner/repo` GitHub last reported in a verified delivery, when it differs
	 * from the tracked name — a rename, a transfer, or a webhook added to the wrong
	 * repository. Null while they match.
	 */
	observedFullName: string | null;
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
	/** Channel for delivery-failure alerts, or null when alerts are off. */
	alertChannelId: string | null;
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
	/**
	 * Previous current secret retained for verifyWithFallback, or null when it is
	 * not worth keeping (it was stored under a `MASTER_KEY` that has since changed).
	 */
	encryptedPreviousSecret: string | null;
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

/** Everything a processed delivery can end as. `ping` is GitHub's setup handshake. */
export const DELIVERY_OUTCOMES = [
	"delivered",
	"filtered",
	"disabled",
	"paused",
	"no_message",
	"unsupported",
	"ping",
	"bad_channel",
	"failed",
] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

export function isDeliveryOutcome(value: unknown): value is DeliveryOutcome {
	return typeof value === "string" && (DELIVERY_OUTCOMES as readonly string[]).includes(value);
}

export interface NewDeliveryLogEntry {
	trackingId: string;
	deliveryId: string;
	/** The `X-GitHub-Event` name, e.g. `pull_request`. */
	event: string;
	/** The payload's `action`, e.g. `opened`, when it has one. */
	action: string | null;
	outcome: DeliveryOutcome;
	/** Why: the filter that dropped it, or Discord's error. Never payload contents. */
	detail: string | null;
}

export interface DeliveryLogEntry extends NewDeliveryLogEntry {
	id: number;
	createdAt: Date;
}

export interface DeliveryLogQuery {
	limit: number;
	/** Only entries older than this id, for paging backwards. */
	before?: number;
	outcome?: DeliveryOutcome;
}

/** Where a change was made. */
export const AUDIT_SOURCES = ["dashboard", "command"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export interface NewAuditEntry {
	guildId: string;
	/** Discord user id of whoever made the change. */
	userId: string;
	/** Their username at the time, so the history still reads after a rename. */
	username: string | null;
	source: AuditSource;
	/** A stable key such as `repo.added` or `secret.rotated`. */
	action: string;
	/** The repository it applied to as `owner/repo`, or null for a server setting. */
	target: string | null;
	/** A short qualifier, e.g. the event a test message used. Never a secret. */
	detail: string | null;
}

export interface AuditEntry extends NewAuditEntry {
	id: number;
	createdAt: Date;
}

export interface AuditQuery {
	limit: number;
	/** Only entries older than this id, for paging backwards. */
	before?: number;
}

/** Identifies one dashboard sign-in when asking whether it has been ended. */
export interface SessionRef {
	sid: string;
	userId: string;
	issuedAt: number;
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
	/**
	 * Forgets a recorded delivery that never reached Discord, so GitHub's
	 * "Redeliver" (which reuses the same X-GitHub-Delivery id) is processed again
	 * instead of being dropped as a duplicate.
	 */
	releaseDelivery(deliveryId: string): Promise<void>;
	/**
	 * Marks the bot as removed from a server (a date) or back in it (null). An existing
	 * mark is kept, so restarts never reset the grace period.
	 */
	setGuildLeft(guildId: string, leftAt: Date | null): Promise<void>;
	/** Every server GitHuBot holds data for, to reconcile against Discord at startup. */
	listGuildIds(): Promise<string[]>;
	/**
	 * Deletes every server the bot left before `cutoff`, with its tracked repositories
	 * (by cascade) and their delivery records. Returns how many servers were purged.
	 */
	purgeGuildsLeftBefore(cutoff: Date): Promise<number>;
	/** Records the name GitHub reports for this webhook, or null when it matches. */
	setObservedFullName(trackingId: string, fullName: string | null): Promise<void>;
	/** Appends to the delivery log shown on the dashboard. */
	recordDeliveryLog(entry: NewDeliveryLogEntry): Promise<void>;
	/** Newest first, across the given repositories. */
	listDeliveryLog(trackingIds: string[], query: DeliveryLogQuery): Promise<DeliveryLogEntry[]>;
	/** How many logged deliveries ended in each outcome since `since`. */
	deliveryOutcomeCounts(
		trackingIds: string[],
		since: Date,
	): Promise<Partial<Record<DeliveryOutcome, number>>>;
	/** Deletes ledger and log rows older than `olderThan`; returns how many ledger rows went. */
	pruneDeliveries(olderThan: Date): Promise<number>;
	/** Updates the health counters shown by `/repo health` and `/repo list`. */
	recordDeliveryResult(result: DeliveryResult): Promise<void>;
	/**
	 * Deliveries received per UTC day for each tracking id, oldest first, one
	 * entry per day so the caller can render a fixed-width sparkline.
	 * Counts every delivery accepted from GitHub — including ones later filtered
	 * or disabled — so it reads as repository activity, not messages posted.
	 */
	activityByDay(trackingIds: string[], days: number): Promise<Map<string, number[]>>;

	/** Appends to the server's change history. */
	recordAudit(entry: NewAuditEntry): Promise<void>;
	/** Newest first. */
	listAudit(guildId: string, query: AuditQuery): Promise<AuditEntry[]>;
	/** Deletes change-history rows older than `olderThan`. */
	pruneAudit(olderThan: Date): Promise<void>;

	/** Ends one dashboard sign-in. The record is kept until the session would have expired. */
	revokeSession(sid: string, expiresAt: Date): Promise<void>;
	/** Ends every dashboard sign-in this user started at or before `at`. */
	revokeUserSessions(userId: string, at: Date, expiresAt: Date): Promise<void>;
	isSessionRevoked(session: SessionRef): Promise<boolean>;
	/** Drops revocation records whose sessions have expired anyway. */
	pruneRevocations(now: Date): Promise<void>;
}
