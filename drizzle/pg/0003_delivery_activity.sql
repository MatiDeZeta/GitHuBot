-- The dashboard reads per-repository delivery activity for the last N days.
-- Without this the query range-scans the created_at index and filters by
-- tracking_id row by row, which degrades as the deliveries ledger grows.
CREATE INDEX IF NOT EXISTS "deliveries_tracking_created_idx"
  ON "deliveries" ("tracking_id", "created_at");
