import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { parseEnabledEvents, type EventType } from "../config/events.js";
import * as schema from "./schema.sqlite.js";
import type {
	CreateTrackedRepoInput,
	RepoRepository,
	RotateSecretInput,
	TrackedRepo,
} from "./types.js";

type SqliteDb = ReturnType<typeof drizzle<typeof schema>>;

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

export function createSqliteRepository(db: SqliteDb): RepoRepository {
	return {
		async ensureGuild(guildId) {
			db.insert(schema.guilds).values({ guildId }).onConflictDoNothing().run();
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
			return mapRow(row);
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
			return row ? mapRow(row) : null;
		},

		async listRepos(guildId) {
			const rows = db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.guildId, guildId))
				.all();
			return rows.map(mapRow);
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
			return row ? mapRow(row) : null;
		},

		async findByTrackingId(trackingId) {
			const row = db
				.select()
				.from(schema.trackedRepos)
				.where(eq(schema.trackedRepos.trackingId, trackingId))
				.get();
			return row ? mapRow(row) : null;
		},

		async updateChannel(guildId, owner, repo, channelId) {
			const row = db
				.update(schema.trackedRepos)
				.set({ channelId, updatedAt: new Date() })
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				)
				.returning()
				.get();
			return row ? mapRow(row) : null;
		},

		async updateEvents(guildId, owner, repo, enabledEvents: EventType[]) {
			const row = db
				.update(schema.trackedRepos)
				.set({ enabledEvents, updatedAt: new Date() })
				.where(
					and(
						eq(schema.trackedRepos.guildId, guildId),
						eq(schema.trackedRepos.owner, owner),
						eq(schema.trackedRepos.repo, repo),
					),
				)
				.returning()
				.get();
			return row ? mapRow(row) : null;
		},

		async rotateSecret(input: RotateSecretInput) {
			const row = db
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
				.returning()
				.get();
			return row ? mapRow(row) : null;
		},

		async clearPreviousSecret(trackingId) {
			db.update(schema.trackedRepos)
				.set({ encryptedPreviousSecret: null, updatedAt: new Date() })
				.where(eq(schema.trackedRepos.trackingId, trackingId))
				.run();
		},

		async tryRecordDelivery(deliveryId, trackingId) {
			const existing = db
				.select()
				.from(schema.deliveries)
				.where(eq(schema.deliveries.deliveryId, deliveryId))
				.get();
			if (existing) return false;
			db.insert(schema.deliveries).values({ deliveryId, trackingId }).run();
			return true;
		},
	};
}
