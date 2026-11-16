import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { EventType } from "../config/events.js";
import { clampError, mapGuildRow, mapRepoRow } from "./mapping.js";
import * as schema from "./schema.pg.js";
import {
	AUDIT_SOURCES,
	type AuditEntry,
	type CreateTrackedRepoInput,
	type DeliveryLogEntry,
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

/** UTC day index, shared by both dialects so buckets line up. */
function dayIndex(ms: number): number {
	return Math.floor(ms / 86_400_000);
}

/** Fixed-width buckets, oldest first, zero-filled for days with no traffic. */
function emptyBuckets(days: number): number[] {
	return new Array<number>(days).fill(0);
}

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

function toLogEntry(row: typeof schema.deliveryLog.$inferSelect): DeliveryLogEntry {
	return {
		id: row.id,
		trackingId: row.trackingId,
		deliveryId: row.deliveryId,
		event: row.event,
		action: row.action,
		// An outcome written by a newer version reads as a failure rather than vanishing.
		outcome: isDeliveryOutcome(row.outcome) ? row.outcome : "failed",
		detail: row.detail,
		createdAt: row.createdAt,
	};
}

function toAuditEntry(row: typeof schema.auditLog.$inferSelect): AuditEntry {
	return {
		id: row.id,
		guildId: row.guildId,
		userId: row.userId,
		username: row.username,
		source: (AUDIT_SOURCES as readonly string[]).includes(row.source)
			? (row.source as AuditEntry["source"])
			: "dashboard",
		action: row.action,
		target: row.target,
		detail: row.detail,
		createdAt: row.createdAt,
	};
}

/** Short free text only; a long value is a bug upstream, not something to store. */
function clip(value: string | null, max: number): string | null {
	return value === null ? null : value.slice(0, max);
}

type PgDb = PostgresJsDatabase<typeof schema>;

type RepoUpdate = Partial<typeof schema.trackedRepos.$inferInsert>;

export function createPgRepository(db: PgDb): RepoRepository {
	async function updateRepo(
		guildId: string,
		owner: string,
		repo: string,
		values: RepoUpdate,
	): Promise<TrackedRepo | null> {
		const [row] = await db
			.update(schema.trackedRepos)
			.set({ ...values, updatedAt: new Date() })
			.where(repoMatches(guildId, owner, repo))
			.returning();
		return row ? mapRepoRow(row) : null;
	}

	return {
		async ensureGuild(guildId) {
			await db.insert(schema.guilds).values({ guildId }).onConflictDoNothing();
		},

		async getGuildSettings(guildId): Promise<GuildSettings | null> {
			const [row] = await db.select().from(schema.guilds).where(eq(schema.guilds.guildId, guildId));
			return row ? mapGuildRow(row) : null;
		},

		async updateGuildSettings(guildId, settings) {
			await this.ensureGuild(guildId);
			await db
				.update(schema.guilds)
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
				.where(eq(schema.guilds.guildId, guildId));
		},

		async addRepo(input: CreateTrackedRepoInput) {
			await this.ensureGuild(input.guildId);
			const [row] = await db
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
				.returning();
			if (!row) throw new Error("Failed to insert tracked repo");
			return mapRepoRow(row);
		},

		async removeRepo(guildId, owner, repo) {
			const [row] = await db
				.delete(schema.trackedRepos)
				.where(repoMatches(guildId, owner, repo))
				.returning();
			// Nothing about a removed repository outlives it, not even its delivery ids.
			if (row) {
				await db.delete(schema.deliveries).where(eq(schema.deliveries.trackingId, row.trackingId));
				await db
					.delete(schema.deliveryLog)
					.where(eq(schema.deliveryLog.trackingId, row.trackingId));
			}
			return row ? mapRepoRow(row) : null;
		},

		async listRepos(guildId) {
			const rows = await db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.guildId, guildId));
			return rows.map(mapRepoRow);
		},

		async countTrackedRepos() {
			const [row] = await db.select({ value: count() }).from(schema.trackedRepos);
			return row?.value ?? 0;
		},

		async getRepo(guildId, owner, repo) {
			const [row] = await db
				.select()
				.from(schema.trackedRepos)
				.where(repoMatches(guildId, owner, repo));
			return row ? mapRepoRow(row) : null;
		},

		async findByTrackingId(trackingId) {
			const [row] = await db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.trackingId, trackingId));
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
			await db
				.update(schema.trackedRepos)
				.set({ encryptedPreviousSecret: null, updatedAt: new Date() })
				.where(eq(schema.trackedRepos.trackingId, trackingId));
		},

		async tryRecordDelivery(deliveryId, trackingId) {
			// Single atomic statement: a concurrent redelivery of the same X-GitHub-Delivery
			// loses the insert race and reads back as a duplicate instead of throwing.
			const rows = await db
				.insert(schema.deliveries)
				.values({ deliveryId, trackingId })
				.onConflictDoNothing()
				.returning({ deliveryId: schema.deliveries.deliveryId });
			return rows.length > 0;
		},

		async setGuildLeft(guildId, leftAt) {
			const pending = leftAt ? isNull(schema.guilds.leftAt) : isNotNull(schema.guilds.leftAt);
			await db
				.update(schema.guilds)
				.set({ leftAt, updatedAt: new Date() })
				.where(and(eq(schema.guilds.guildId, guildId), pending));
		},

		async listGuildIds() {
			const rows = await db.select({ guildId: schema.guilds.guildId }).from(schema.guilds);
			return rows.map((row) => row.guildId);
		},

		async purgeGuildsLeftBefore(cutoff) {
			return db.transaction(async (tx) => {
				const gone = (
					await tx
						.select({ guildId: schema.guilds.guildId })
						.from(schema.guilds)
						.where(lt(schema.guilds.leftAt, cutoff))
				).map((row) => row.guildId);
				if (gone.length === 0) return 0;
				const trackingIds = (
					await tx
						.select({ trackingId: schema.trackedRepos.trackingId })
						.from(schema.trackedRepos)
						.where(inArray(schema.trackedRepos.guildId, gone))
				).map((row) => row.trackingId);
				if (trackingIds.length > 0) {
					await tx
						.delete(schema.deliveries)
						.where(inArray(schema.deliveries.trackingId, trackingIds));
					await tx
						.delete(schema.deliveryLog)
						.where(inArray(schema.deliveryLog.trackingId, trackingIds));
				}
				await tx.delete(schema.auditLog).where(inArray(schema.auditLog.guildId, gone));
				// Tracked repositories go with the guild through ON DELETE CASCADE.
				await tx.delete(schema.guilds).where(inArray(schema.guilds.guildId, gone));
				return gone.length;
			});
		},

		async setObservedFullName(trackingId, fullName) {
			await db
				.update(schema.trackedRepos)
				.set({ observedFullName: fullName })
				.where(eq(schema.trackedRepos.trackingId, trackingId));
		},

		async releaseDelivery(deliveryId) {
			await db.delete(schema.deliveries).where(eq(schema.deliveries.deliveryId, deliveryId));
		},

		async pruneDeliveries(olderThan) {
			const result = await db
				.delete(schema.deliveries)
				.where(lt(schema.deliveries.createdAt, olderThan));
			await db.delete(schema.deliveryLog).where(lt(schema.deliveryLog.createdAt, olderThan));
			return result.count;
		},

		async recordDeliveryLog(entry) {
			await db
				.insert(schema.deliveryLog)
				.values({ ...entry, detail: clampError(entry.detail ?? undefined) });
		},

		async listDeliveryLog(trackingIds, query) {
			if (trackingIds.length === 0) return [];
			const rows = await db
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
				.limit(query.limit);
			return rows.map(toLogEntry);
		},

		async deliveryOutcomeCounts(trackingIds, since) {
			const counts: Partial<Record<DeliveryOutcome, number>> = {};
			if (trackingIds.length === 0) return counts;
			const rows = await db
				.select({ outcome: schema.deliveryLog.outcome, total: count() })
				.from(schema.deliveryLog)
				.where(
					and(
						inArray(schema.deliveryLog.trackingId, trackingIds),
						gte(schema.deliveryLog.createdAt, since),
					),
				)
				.groupBy(schema.deliveryLog.outcome);
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
			// createdAt is a timestamptz here, so bucket with date_trunc.
			const day = sql<string>`date_trunc('day', ${schema.deliveries.createdAt} at time zone 'UTC')`;
			const rows = await db
				.select({ trackingId: schema.deliveries.trackingId, day, total: count() })
				.from(schema.deliveries)
				.where(
					and(
						inArray(schema.deliveries.trackingId, trackingIds),
						gte(schema.deliveries.createdAt, since),
					),
				)
				.groupBy(schema.deliveries.trackingId, day);

			for (const row of rows) {
				const slot = buckets.get(row.trackingId);
				const offset = days - 1 - (today - dayIndex(new Date(row.day).getTime()));
				if (slot && offset >= 0 && offset < days) slot[offset] = Number(row.total);
			}
			return buckets;
		},

		async recordDeliveryResult(result: DeliveryResult) {
			const now = new Date();
			await db
				.update(schema.trackedRepos)
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
				.where(eq(schema.trackedRepos.trackingId, result.trackingId));
		},

		async recordAudit(entry) {
			await db.insert(schema.auditLog).values({
				...entry,
				username: clip(entry.username, 64),
				action: entry.action.slice(0, 64),
				target: clip(entry.target, 200),
				detail: clip(entry.detail, 200),
			});
		},

		async listAudit(guildId, query) {
			const rows = await db
				.select()
				.from(schema.auditLog)
				.where(
					and(
						eq(schema.auditLog.guildId, guildId),
						query.before !== undefined ? lt(schema.auditLog.id, query.before) : undefined,
					),
				)
				.orderBy(desc(schema.auditLog.id))
				.limit(query.limit);
			return rows.map(toAuditEntry);
		},

		async pruneAudit(olderThan) {
			await db.delete(schema.auditLog).where(lt(schema.auditLog.createdAt, olderThan));
		},

		async revokeSession(sid, expiresAt) {
			await db
				.insert(schema.sessionRevocations)
				.values({ key: `s:${sid}`, revokedAt: new Date(), expiresAt })
				.onConflictDoNothing();
		},

		async revokeUserSessions(userId, at, expiresAt) {
			await db
				.insert(schema.sessionRevocations)
				.values({ key: `u:${userId}`, revokedAt: at, expiresAt })
				.onConflictDoUpdate({
					target: schema.sessionRevocations.key,
					set: { revokedAt: at, expiresAt },
				});
		},

		async isSessionRevoked(session) {
			const rows = await db
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
				.limit(1);
			return rows.length > 0;
		},

		async pruneRevocations(now) {
			await db
				.delete(schema.sessionRevocations)
				.where(lt(schema.sessionRevocations.expiresAt, now));
		},
	};
}
