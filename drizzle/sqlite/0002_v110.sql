-- Migration: v1.1.0 — per-repo delivery settings, filters, routing and health.
-- Every column is nullable or defaulted so existing rows upgrade untouched.

ALTER TABLE `tracked_repos` ADD COLUMN `paused` integer NOT NULL DEFAULT 0;
ALTER TABLE `tracked_repos` ADD COLUMN `display_mode` text;
ALTER TABLE `tracked_repos` ADD COLUMN `theme` text;
ALTER TABLE `tracked_repos` ADD COLUMN `locale` text;
ALTER TABLE `tracked_repos` ADD COLUMN `branch_include` text;
ALTER TABLE `tracked_repos` ADD COLUMN `branch_exclude` text;
ALTER TABLE `tracked_repos` ADD COLUMN `label_filter` text;
ALTER TABLE `tracked_repos` ADD COLUMN `ignored_actors` text;
ALTER TABLE `tracked_repos` ADD COLUMN `event_routes` text;
ALTER TABLE `tracked_repos` ADD COLUMN `mention_rules` text;
ALTER TABLE `tracked_repos` ADD COLUMN `last_delivery_at` integer;
ALTER TABLE `tracked_repos` ADD COLUMN `last_success_at` integer;
ALTER TABLE `tracked_repos` ADD COLUMN `last_error_at` integer;
ALTER TABLE `tracked_repos` ADD COLUMN `last_error` text;
ALTER TABLE `tracked_repos` ADD COLUMN `delivered_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `tracked_repos` ADD COLUMN `failed_count` integer NOT NULL DEFAULT 0;

ALTER TABLE `guilds` ADD COLUMN `locale` text;
ALTER TABLE `guilds` ADD COLUMN `default_theme` text;
ALTER TABLE `guilds` ADD COLUMN `default_display_mode` text;

CREATE INDEX IF NOT EXISTS `tracked_repos_guild_idx` ON `tracked_repos` (`guild_id`);
CREATE INDEX IF NOT EXISTS `deliveries_created_at_idx` ON `deliveries` (`created_at`);
