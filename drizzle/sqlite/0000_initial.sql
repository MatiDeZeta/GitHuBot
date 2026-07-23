-- Migration: initial schema (SQLite)

CREATE TABLE IF NOT EXISTS `guilds` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `tracked_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`channel_id` text NOT NULL,
	`tracking_id` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`enabled_events` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`guild_id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS `tracked_repos_tracking_id_unique` ON `tracked_repos` (`tracking_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `tracked_repos_guild_owner_repo_idx` ON `tracked_repos` (`guild_id`,`owner`,`repo`);

CREATE TABLE IF NOT EXISTS `deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`tracking_id` text NOT NULL,
	`created_at` integer NOT NULL
);
