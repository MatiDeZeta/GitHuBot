-- Migration: v1.1.0 — per-repo delivery settings, filters, routing and health.
-- Every column is nullable or defaulted so existing rows upgrade untouched.

ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "paused" boolean NOT NULL DEFAULT false;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "display_mode" text;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "theme" text;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "locale" text;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "branch_include" jsonb;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "branch_exclude" jsonb;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "label_filter" jsonb;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "ignored_actors" jsonb;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "event_routes" jsonb;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "mention_rules" jsonb;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "last_delivery_at" timestamptz;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "last_success_at" timestamptz;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "last_error_at" timestamptz;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "last_error" text;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "delivered_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "tracked_repos" ADD COLUMN IF NOT EXISTS "failed_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "locale" text;
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "default_theme" text;
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "default_display_mode" text;

CREATE INDEX IF NOT EXISTS "tracked_repos_guild_idx" ON "tracked_repos" ("guild_id");
CREATE INDEX IF NOT EXISTS "deliveries_created_at_idx" ON "deliveries" ("created_at");
