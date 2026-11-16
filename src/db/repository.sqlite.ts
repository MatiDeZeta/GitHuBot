import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { EventType } from "../config/events.js";
import {
	clampError,
	clip,
	dayIndex,
	emptyBuckets,
	mapGuildRow,
	mapRepoRow,
	toAuditEntry,
	toLogEntry,
} from "./mapping.js";
import * as schema from "./schema.sqlite.js";
import {
	type CreateTrackedRepoInput,
	type DeliveryOutcome,
	type DeliveryResult,
	type GuildSettings,
	isDeliveryOutcome,
	type RepoFilters,
	type RepoRepository,
	type RepoStyleInput,
	type RotateSecretInput,
	type TrackedRepo,
} from "./types.js";

/**
 * GitHub treats owner and repository names case-insensitively, so `/repo remove
 * acme/app` must find a repository added as `Acme/App` — and adding it twice under
 * different casing must be caught as a duplicate.
 */
function repoMatches(guildId: string, owner: string, repo: string) {
	return and(
		eq(schema.trackedRepos.guildId, guildId),
		sql`lower(${schema.trackedRepos.owner}) = lower(${owner})`,
		sql`lower(${schema.trackedRepos.repo}) = lower(${repo})`,
	);
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
			.where(repoMatches(guildId, owner, repo))
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
					...(settings.alertChannelId !== undefined
						? { alertChannelId: settings.alertChannelId }
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
				.where(repoMatches(guildId, owner, repo))
				.returning()
				.get();
			// Nothing about a removed repository outlives it, not even its delivery ids.
			if (row) {
				db.delete(schema.deliveries).where(eq(schema.deliveries.trackingId, row.trackingId)).run();
				db.delete(schema.deliveryLog)
					.where(eq(schema.deliveryLog.trackingId, row.trackingId))
					.run();
			}
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
				.where(repoMatches(guildId, owner, repo))
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

		async setGuildLeft(guildId, leftAt) {
			const pending = leftAt ? isNull(schema.guilds.leftAt) : isNotNull(schema.guilds.leftAt);
			db.update(schema.guilds)
				.set({ leftAt, updatedAt: new Date() })
				.where(and(eq(schema.guilds.guildId, guildId), pending))
				.run();
		},

		async listGuildIds() {
			return db
				.select({ guildId: schema.guilds.guildId })
				.from(schema.guilds)
				.all()
				.map((row) => row.guildId);
		},

		async purgeGuildsLeftBefore(cutoff) {
			const gone = db
				.select({ guildId: schema.guilds.guildId })
				.from(schema.guilds)
				.where(lt(schema.guilds.leftAt, cutoff))
				.all()
				.map((row) => row.guildId);
			if (gone.length === 0) return 0;
			db.transaction((tx) => {
				const trackingIds = tx
					.select({ trackingId: schema.trackedRepos.trackingId })
					.from(schema.trackedRepos)
					.where(inArray(schema.trackedRepos.guildId, gone))
					.all()
					.map((row) => row.trackingId);
				if (trackingIds.length > 0) {
					tx.delete(schema.deliveries)
						.where(inArray(schema.deliveries.trackingId, trackingIds))
						.run();
					tx.delete(schema.deliveryLog)
						.where(inArray(schema.deliveryLog.trackingId, trackingIds))
						.run();
				}
				tx.delete(schema.auditLog).where(inArray(schema.auditLog.guildId, gone)).run();
				// Tracked repositories go with the guild through ON DELETE CASCADE.
				tx.delete(schema.guilds).where(inArray(schema.guilds.guildId, gone)).run();
			});
			return gone.length;
		},

		async setObservedFullName(trackingId, fullName) {
			db.update(schema.trackedRepos)
				.set({ observedFullName: fullName })
				.where(eq(schema.trackedRepos.trackingId, trackingId))
				.run();
		},

		async releaseDelivery(deliveryId) {
			db.delete(schema.deliveries).where(eq(schema.deliveries.deliveryId, deliveryId)).run();
		},

		async pruneDeliveries(olderThan) {
			const result = db
				.delete(schema.deliveries)
				.where(lt(schema.deliveries.createdAt, olderThan))
				.run();
			db.delete(schema.deliveryLog).where(lt(schema.deliveryLog.createdAt, olderThan)).run();
			return result.changes;
		},

		async recordDeliveryLog(entry) {
			db.insert(schema.deliveryLog)
				.values({ ...entry, detail: clampError(entry.detail ?? undefined) })
				.run();
		},

		async listDeliveryLog(trackingIds, query) {
			if (trackingIds.length === 0) return [];
			const rows = db
				.select()
				.from(schema.deliveryLog)
				.where(
					and(
						inArray(schema.deliveryLog.trackingId, trackingIds),
						query.before !== undefined ? lt(schema.deliveryLog.id, query.before) : undefined,
						query.outcome ? eq(schema.deliveryLog.outcome, query.outcome) : undefined,
					),
				)
				.orderBy(desc(schema.deliveryLog.id))
				.limit(query.limit)
				.all();
			return rows.map(toLogEntry);
		},

		async deliveryOutcomeCounts(trackingIds, since) {
			const counts: Partial<Record<DeliveryOutcome, number>> = {};
			if (trackingIds.length === 0) return counts;
			const rows = db
				.select({ outcome: schema.deliveryLog.outcome, total: count() })
				.from(schema.deliveryLog)
				.where(
					and(
						inArray(schema.deliveryLog.trackingId, trackingIds),
						gte(schema.deliveryLog.createdAt, since),
					),
				)
				.groupBy(schema.deliveryLog.outcome)
				.all();
			for (const row of rows) {
				if (isDeliveryOutcome(row.outcome)) counts[row.outcome] = Number(row.total);
			}
			return counts;
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

		async recordAudit(entry) {
			db.insert(schema.auditLog)
				.values({
					...entry,
					username: clip(entry.username, 64),
					action: entry.action.slice(0, 64),
					target: clip(entry.target, 200),
					detail: clip(entry.detail, 200),
				})
				.run();
		},

		async listAudit(guildId, query) {
			return db
				.select()
				.from(schema.auditLog)
				.where(
					and(
						eq(schema.auditLog.guildId, guildId),
						query.before !== undefined ? lt(schema.auditLog.id, query.before) : undefined,
					),
				)
				.orderBy(desc(schema.auditLog.id))
				.limit(query.limit)
				.all()
				.map(toAuditEntry);
		},

		async pruneAudit(olderThan) {
			db.delete(schema.auditLog).where(lt(schema.auditLog.createdAt, olderThan)).run();
		},

		async revokeSession(sid, expiresAt) {
			db.insert(schema.sessionRevocations)
				.values({ key: `s:${sid}`, revokedAt: new Date(), expiresAt })
				.onConflictDoNothing()
				.run();
		},

		async revokeUserSessions(userId, at, expiresAt) {
			db.insert(schema.sessionRevocations)
				.values({ key: `u:${userId}`, revokedAt: at, expiresAt })
				.onConflictDoUpdate({
					target: schema.sessionRevocations.key,
					set: { revokedAt: at, expiresAt },
				})
				.run();
		},

		async isSessionRevoked(session) {
			const row = db
				.select({ key: schema.sessionRevocations.key })
				.from(schema.sessionRevocations)
				.where(
					or(
						eq(schema.sessionRevocations.key, `s:${session.sid}`),
						and(
							eq(schema.sessionRevocations.key, `u:${session.userId}`),
							gte(schema.sessionRevocations.revokedAt, new Date(session.issuedAt)),
						),
					),
				)
				.limit(1)
				.get();
			return row !== undefined;
		},

		async pruneRevocations(now) {
			db.delete(schema.sessionRevocations)
				.where(lt(schema.sessionRevocations.expiresAt, now))
				.run();
		},
	};
}
