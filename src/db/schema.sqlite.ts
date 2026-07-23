import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const guilds = sqliteTable("guilds", {
	guildId: text("guild_id").primaryKey(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export const trackedRepos = sqliteTable(
	"tracked_repos",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		guildId: text("guild_id")
			.notNull()
			.references(() => guilds.guildId, { onDelete: "cascade" }),
		owner: text("owner").notNull(),
		repo: text("repo").notNull(),
		channelId: text("channel_id").notNull(),
		trackingId: text("tracking_id").notNull().unique(),
		encryptedSecret: text("encrypted_secret").notNull(),
		/** Previous secret kept during rotation so verifyWithFallback can bridge the cutover. */
		encryptedPreviousSecret: text("encrypted_previous_secret"),
		enabledEvents: text("enabled_events", { mode: "json" }).notNull().$type<string[]>(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("tracked_repos_guild_owner_repo_idx").on(table.guildId, table.owner, table.repo),
	],
);

export const deliveries = sqliteTable("deliveries", {
	deliveryId: text("delivery_id").primaryKey(),
	trackingId: text("tracking_id").notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export type TrackedRepoRow = typeof trackedRepos.$inferSelect;
export type NewTrackedRepo = typeof trackedRepos.$inferInsert;
