-- Migration: initial schema (Postgres)

CREATE TABLE IF NOT EXISTS "guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tracked_repos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"channel_id" text NOT NULL,
	"tracking_id" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"enabled_events" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_repos_guild_id_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("guild_id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "tracked_repos_tracking_id_unique" ON "tracked_repos" USING btree ("tracking_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tracked_repos_guild_owner_repo_idx" ON "tracked_repos" USING btree ("guild_id","owner","repo");

CREATE TABLE IF NOT EXISTS "deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"tracking_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
