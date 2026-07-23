-- Migration: retain previous webhook secret for rotation fallback

ALTER TABLE "tracked_repos" ADD COLUMN "encrypted_previous_secret" text;
