-- The repository name GitHub last reported for this webhook, when it differs
-- from the tracked name: a rename, a transfer, or a webhook added to the wrong
-- repository. Cleared as soon as a delivery matches again. Nullable, so
-- existing rows upgrade untouched.
ALTER TABLE `tracked_repos` ADD COLUMN `observed_full_name` text;
