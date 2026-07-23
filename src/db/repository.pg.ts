import { and, count, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { parseEnabledEvents, type EventType } from "../config/events.js";
import * as schema from "./schema.pg.js";
import type {
	CreateTrackedRepoInput,
	RepoRepository,
	RotateSecretInput,
	TrackedRepo,
} from "./types.js";

type PgDb = PostgresJsDatabase<typeof schema>;

function mapRow(row: typeof schema.trackedRepos.$inferSelect): TrackedRepo {
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
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createPgRepository(db: PgDb): RepoRepository {
	return {
		async ensureGuild(guildId) {
			await db.insert(schema.guilds).values({ guildId }).onConflictDoNothing();
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
			return mapRow(row);
		},

		async removeRepo(guildId, owner, repo) {
			const [row] = await db
				.delete(schema.trackedRepos)
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				)
				.returning();
			return row ? mapRow(row) : null;
		},

		async listRepos(guildId) {
			const rows = await db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.guildId, guildId));
			return rows.map(mapRow);
		},

		async countTrackedRepos() {
			const [row] = await db
				.select({ value: count() })
				.from(schema.trackedRepos);
			return row?.value ?? 0;
		},

		async getRepo(guildId, owner, repo) {
			const [row] = await db
				.select()
				.from(schema.trackedRepos)
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				);
			return row ? mapRow(row) : null;
		},

		async findByTrackingId(trackingId) {
			const [row] = await db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.trackingId, trackingId));
			return row ? mapRow(row) : null;
		},

		async updateChannel(guildId, owner, repo, channelId) {
			const [row] = await db
				.update(schema.trackedRepos)
				.set({ channelId, updatedAt: new Date() })
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				)
				.returning();
			return row ? mapRow(row) : null;
		},

		async updateEvents(guildId, owner, repo, enabledEvents: EventType[]) {
			const [row] = await db
				.update(schema.trackedRepos)
				.set({ enabledEvents, updatedAt: new Date() })
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				)
				.returning();
			return row ? mapRow(row) : null;
		},

		async rotateSecret(input: RotateSecretInput) {
			const [row] = await db
				.update(schema.trackedRepos)
				.set({
					encryptedSecret: input.encryptedSecret,
					encryptedPreviousSecret: input.encryptedPreviousSecret,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(schema.trackedRepos.guildId, input.guildId),
						eq(schema.trackedRepos.owner, input.owner),
						eq(schema.trackedRepos.repo, input.repo),
					),
				)
				.returning();
			return row ? mapRow(row) : null;
		},

		async clearPreviousSecret(trackingId) {
			await db
				.update(schema.trackedRepos)
				.set({ encryptedPreviousSecret: null, updatedAt: new Date() })
				.where(eq(schema.trackedRepos.trackingId, trackingId));
		},

		async tryRecordDelivery(deliveryId, trackingId) {
			const existing = await db
				.select()
				.from(schema.deliveries)
				.where(eq(schema.deliveries.deliveryId, deliveryId));
			if (existing.length > 0) return false;
			await db.insert(schema.deliveries).values({ deliveryId, trackingId });
			return true;
		},
	};
}
