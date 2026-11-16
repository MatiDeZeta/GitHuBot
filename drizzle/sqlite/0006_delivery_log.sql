-- What happened to each delivery, for the dashboard's delivery log. Metadata only:
-- the event name, its action, the outcome and a short reason. No payload contents.
-- Pruned with the deliveries ledger and deleted with the repository.
CREATE TABLE IF NOT EXISTS `delivery_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tracking_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`event` text NOT NULL,
	`action` text,
	`outcome` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `delivery_log_tracking_idx` ON `delivery_log` (`tracking_id`, `id`);
CREATE INDEX IF NOT EXISTS `delivery_log_created_at_idx` ON `delivery_log` (`created_at`);
