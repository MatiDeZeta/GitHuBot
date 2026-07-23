import { bigserial, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const guilds = pgTable("guilds", {
	guildId: text("guild_id").primaryKey(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.notNull()
		.defaultNow(),
});

export const trackedRepos = pgTable(
	"tracked_repos",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		guildId: text("guild_id")
			.notNull()
			.references(() => guilds.guildId, { onDelete: "cascade" }),
		owner: text("owner").notNull(),
		repo: text("repo").notNull(),
		channelId: text("channel_id").notNull(),
		trackingId: text("tracking_id").notNull().unique(),
		encryptedSecret: text("encrypted_secret").notNull(),
		encryptedPreviousSecret: text("encrypted_previous_secret"),
		enabledEvents: jsonb("enabled_events").notNull().$type<string[]>(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("tracked_repos_guild_owner_repo_idx").on(table.guildId, table.owner, table.repo),
	],
);

export const deliveries = pgTable("deliveries", {
	deliveryId: text("delivery_id").primaryKey(),
	trackingId: text("tracking_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
		.notNull()
		.defaultNow(),
});

export type TrackedRepoRow = typeof trackedRepos.$inferSelect;
export type NewTrackedRepo = typeof trackedRepos.$inferInsert;
