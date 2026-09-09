import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { EventType } from "../config/events.js";
import { clampError, mapGuildRow, mapRepoRow } from "./mapping.js";
import * as schema from "./schema.sqlite.js";
import type {
	CreateTrackedRepoInput,
	DeliveryResult,
	GuildSettings,
	RepoFilters,
	RepoRepository,
	RepoStyleInput,
	RotateSecretInput,
	TrackedRepo,
} from "./types.js";

/** UTC day index, shared by both dialects so buckets line up. */
function dayIndex(ms: number): number {
	return Math.floor(ms / 86_400_000);
}

/** Fixed-width buckets, oldest first, zero-filled for days with no traffic. */
function emptyBuckets(days: number): number[] {
	return new Array<number>(days).fill(0);
}

type SqliteDb = BetterSQLite3Database<typeof schema>;

type RepoUpdate = Partial<typeof schema.trackedRepos.$inferInsert>;

export function createSqliteRepository(db: SqliteDb): RepoRepository {
	function updateRepo(
		guildId: string,
		owner: string,
		repo: string,
		values: RepoUpdate,
	): TrackedRepo | null {
		const row = db
			.update(schema.trackedRepos)
			.set({ ...values, updatedAt: new Date() })
			.where(
				and(
					eq(schema.trackedRepos.guildId, guildId),
					eq(schema.trackedRepos.owner, owner),
					eq(schema.trackedRepos.repo, repo),
				),
			)
			.returning()
			.get();
		return row ? mapRepoRow(row) : null;
	}

	return {
		async ensureGuild(guildId) {
			db.insert(schema.guilds).values({ guildId }).onConflictDoNothing().run();
		},

		async getGuildSettings(guildId): Promise<GuildSettings | null> {
			const row = db.select().from(schema.guilds).where(eq(schema.guilds.guildId, guildId)).get();
			return row ? mapGuildRow(row) : null;
		},

		async updateGuildSettings(guildId, settings) {
			await this.ensureGuild(guildId);
			db.update(schema.guilds)
				.set({
					...(settings.locale !== undefined ? { locale: settings.locale } : {}),
					...(settings.defaultTheme !== undefined ? { defaultTheme: settings.defaultTheme } : {}),
					...(settings.defaultDisplayMode !== undefined
						? { defaultDisplayMode: settings.defaultDisplayMode }
						: {}),
					updatedAt: new Date(),
				})
				.where(eq(schema.guilds.guildId, guildId))
				.run();
		},

		async addRepo(input: CreateTrackedRepoInput) {
			await this.ensureGuild(input.guildId);
			const row = db
				.insert(schema.trackedRepos)
				.values({
					guildId: input.guildId,
					owner: input.owner,
					repo: input.repo,
					channelId: input.channelId,
					trackingId: input.trackingId,
					encryptedSecret: input.encryptedSecret,
					encryptedPreviousSecret: null,
					enabledEvents: input.enabledEvents,
				})
				.returning()
				.get();
			if (!row) throw new Error("Failed to insert tracked repo");
			return mapRepoRow(row);
		},

		async removeRepo(guildId, owner, repo) {
			const row = db
				.delete(schema.trackedRepos)
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				)
				.returning()
				.get();
			return row ? mapRepoRow(row) : null;
		},

		async listRepos(guildId) {
			const rows = db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.guildId, guildId))
				.all();
			return rows.map(mapRepoRow);
		},

		async countTrackedRepos() {
			const row = db.select({ value: count() }).from(schema.trackedRepos).get();
			return row?.value ?? 0;
		},

		async getRepo(guildId, owner, repo) {
			const row = db
				.select()
				.from(schema.trackedRepos)
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				)
				.get();
			return row ? mapRepoRow(row) : null;
		},

		async findByTrackingId(trackingId) {
			const row = db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.trackingId, trackingId))
				.get();
			return row ? mapRepoRow(row) : null;
		},

		async updateChannel(guildId, owner, repo, channelId) {
			return updateRepo(guildId, owner, repo, { channelId });
		},

		async updateEvents(guildId, owner, repo, enabledEvents: EventType[]) {
			return updateRepo(guildId, owner, repo, { enabledEvents });
		},

		async setPaused(guildId, owner, repo, paused) {
			return updateRepo(guildId, owner, repo, { paused });
		},

		async updateStyle(guildId, owner, repo, style: RepoStyleInput) {
			return updateRepo(guildId, owner, repo, {
				...(style.theme !== undefined ? { theme: style.theme } : {}),
				...(style.displayMode !== undefined ? { displayMode: style.displayMode } : {}),
				...(style.locale !== undefined ? { locale: style.locale } : {}),
			});
		},

		async updateFilters(guildId, owner, repo, filters: RepoFilters) {
			return updateRepo(guildId, owner, repo, {
				branchInclude: filters.branchInclude,
				branchExclude: filters.branchExclude,
				labelFilter: filters.labels,
				ignoredActors: filters.ignoredActors,
			});
		},

		async updateRoutes(guildId, owner, repo, routes) {
			return updateRepo(guildId, owner, repo, { eventRoutes: routes });
		},

		async updateMentions(guildId, owner, repo, mentions) {
			return updateRepo(guildId, owner, repo, { mentionRules: mentions });
		},

		async rotateSecret(input: RotateSecretInput) {
			return updateRepo(input.guildId, input.owner, input.repo, {
				encryptedSecret: input.encryptedSecret,
				encryptedPreviousSecret: input.encryptedPreviousSecret,
			});
		},

		async clearPreviousSecret(trackingId) {
			db.update(schema.trackedRepos)
				.set({ encryptedPreviousSecret: null, updatedAt: new Date() })
				.where(eq(schema.trackedRepos.trackingId, trackingId))
				.run();
		},

		async tryRecordDelivery(deliveryId, trackingId) {
			// Single atomic statement: a concurrent redelivery of the same X-GitHub-Delivery
			// loses the insert race and reads back as a duplicate instead of throwing.
			const row = db
				.insert(schema.deliveries)
				.values({ deliveryId, trackingId })
				.onConflictDoNothing()
				.returning({ deliveryId: schema.deliveries.deliveryId })
				.get();
			return row !== undefined;
		},

		async activityByDay(trackingIds, days) {
			const buckets = new Map<string, number[]>();
			if (trackingIds.length === 0 || days <= 0) return buckets;
			for (const id of trackingIds) buckets.set(id, emptyBuckets(days));

			const today = dayIndex(Date.now());
			const since = new Date((today - days + 1) * 86_400_000);
			// createdAt is stored as epoch ms, so integer division buckets by day.
			const day = sql<number>`${schema.deliveries.createdAt} / 86400000`;
			const rows = db
				.select({ trackingId: schema.deliveries.trackingId, day, total: count() })
				.from(schema.deliveries)
				.where(
					and(
						inArray(schema.deliveries.trackingId, trackingIds),
						gte(schema.deliveries.createdAt, since),
					),
				)
				.groupBy(schema.deliveries.trackingId, day)
				.all();

			for (const row of rows) {
				const slot = buckets.get(row.trackingId);
				const offset = days - 1 - (today - Number(row.day));
				if (slot && offset >= 0 && offset < days) slot[offset] = Number(row.total);
			}
			return buckets;
		},

		async recordDeliveryResult(result: DeliveryResult) {
			const now = new Date();
			db.update(schema.trackedRepos)
				.set(
					result.success
						? {
								lastDeliveryAt: now,
								lastSuccessAt: now,
								deliveredCount: sql`${schema.trackedRepos.deliveredCount} + 1`,
							}
						: {
								lastDeliveryAt: now,
								lastErrorAt: now,
								lastError: clampError(result.error),
								failedCount: sql`${schema.trackedRepos.failedCount} + 1`,
							},
				)
				.where(eq(schema.trackedRepos.trackingId, result.trackingId))
				.run();
		},
	};
}
