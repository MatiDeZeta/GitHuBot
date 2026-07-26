import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const guilds = sqliteTable("guilds", {
	guildId: text("guild_id").primaryKey(),
	locale: text("locale"),
	defaultTheme: text("default_theme"),
	defaultDisplayMode: text("default_display_mode"),
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

		paused: integer("paused", { mode: "boolean" }).notNull().default(false),
		displayMode: text("display_mode"),
		theme: text("theme"),
		locale: text("locale"),

		branchInclude: text("branch_include", { mode: "json" }).$type<string[]>(),
		branchExclude: text("branch_exclude", { mode: "json" }).$type<string[]>(),
		labelFilter: text("label_filter", { mode: "json" }).$type<string[]>(),
		ignoredActors: text("ignored_actors", { mode: "json" }).$type<string[]>(),
		/** `{ [eventType]: channelId }` overrides for the default channel. */
		eventRoutes: text("event_routes", { mode: "json" }).$type<Record<string, string>>(),
		/** `{ [eventType]: roleId[] }` pings applied before the changelog message. */
		mentionRules: text("mention_rules", { mode: "json" }).$type<Record<string, string[]>>(),

		lastDeliveryAt: integer("last_delivery_at", { mode: "timestamp_ms" }),
		lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
		lastErrorAt: integer("last_error_at", { mode: "timestamp_ms" }),
		lastError: text("last_error"),
		deliveredCount: integer("delivered_count").notNull().default(0),
		failedCount: integer("failed_count").notNull().default(0),

		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("tracked_repos_guild_owner_repo_idx").on(table.guildId, table.owner, table.repo),
		index("tracked_repos_guild_idx").on(table.guildId),
	],
);

export const deliveries = sqliteTable(
	"deliveries",
	{
		deliveryId: text("delivery_id").primaryKey(),
		trackingId: text("tracking_id").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [index("deliveries_created_at_idx").on(table.createdAt)],
);

export type TrackedRepoRow = typeof trackedRepos.$inferSelect;
export type NewTrackedRepo = typeof trackedRepos.$inferInsert;
export type GuildRow = typeof guilds.$inferSelect;
