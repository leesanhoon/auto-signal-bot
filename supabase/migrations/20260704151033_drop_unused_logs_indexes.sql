-- Drop unused indexes on logs table
-- These indexes were created for filtering by timestamp, level, source
-- but the application never queries logs by these columns
-- All logging is INSERT-only; SELECT queries are ad-hoc via Supabase Studio

DROP INDEX IF EXISTS logs_timestamp_idx;
DROP INDEX IF EXISTS logs_level_idx;
DROP INDEX IF EXISTS logs_source_idx;
