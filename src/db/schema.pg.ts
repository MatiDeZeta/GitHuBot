import {
	bigserial,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const guilds = pgTable("guilds", {
	guildId: text("guild_id").primaryKey(),
	locale: text("locale"),
	defaultTheme: text("default_theme"),
	defaultDisplayMode: text("default_display_mode"),
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

		paused: boolean("paused").notNull().default(false),
		displayMode: text("display_mode"),
		theme: text("theme"),
		locale: text("locale"),

		branchInclude: jsonb("branch_include").$type<string[]>(),
		branchExclude: jsonb("branch_exclude").$type<string[]>(),
		labelFilter: jsonb("label_filter").$type<string[]>(),
		ignoredActors: jsonb("ignored_actors").$type<string[]>(),
		/** `{ [eventType]: channelId }` overrides for the default channel. */
		eventRoutes: jsonb("event_routes").$type<Record<string, string>>(),
		/** `{ [eventType]: roleId[] }` pings applied before the changelog message. */
		mentionRules: jsonb("mention_rules").$type<Record<string, string[]>>(),

		lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true, mode: "date" }),
		lastSuccessAt: timestamp("last_success_at", { withTimezone: true, mode: "date" }),
		lastErrorAt: timestamp("last_error_at", { withTimezone: true, mode: "date" }),
		lastError: text("last_error"),
		deliveredCount: integer("delivered_count").notNull().default(0),
		failedCount: integer("failed_count").notNull().default(0),

		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("tracked_repos_guild_owner_repo_idx").on(table.guildId, table.owner, table.repo),
		index("tracked_repos_guild_idx").on(table.guildId),
	],
);

export const deliveries = pgTable(
	"deliveries",
	{
		deliveryId: text("delivery_id").primaryKey(),
		trackingId: text("tracking_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("deliveries_created_at_idx").on(table.createdAt)],
);

export type TrackedRepoRow = typeof trackedRepos.$inferSelect;
export type NewTrackedRepo = typeof trackedRepos.$inferInsert;
export type GuildRow = typeof guilds.$inferSelect;
