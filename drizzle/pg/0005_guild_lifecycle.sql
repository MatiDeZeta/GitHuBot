-- Where delivery-failure alerts go, and when the bot was removed from the server
-- (its data is deleted after a grace period). Both nullable; existing rows upgrade
-- untouched.
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "alert_channel_id" text;
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "left_at" timestamptz;
CREATE INDEX IF NOT EXISTS "guilds_left_at_idx" ON "guilds" ("left_at");
