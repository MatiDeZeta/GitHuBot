-- Who changed what in a server, for the dashboard's history page: the Discord user,
-- where they did it, the action and the repository. No secrets, no payloads.
-- Pruned after 90 days and deleted with the server.
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"detail" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "audit_log_guild_idx" ON "audit_log" ("guild_id", "id");
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" ("created_at");
-- Dashboard sign-ins ended before they expired, so sign-out holds even for a copied
-- cookie. Rows are dropped once the session would have expired anyway.
CREATE TABLE IF NOT EXISTS "session_revocations" (
	"key" text PRIMARY KEY NOT NULL,
	"revoked_at" timestamptz NOT NULL,
	"expires_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "session_revocations_expires_idx" ON "session_revocations" ("expires_at");
