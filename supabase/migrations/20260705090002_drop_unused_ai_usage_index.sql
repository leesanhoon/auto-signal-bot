-- Drop unused ai_usage_source_idx
-- This index was created for filtering by source column
-- but the application filters by source in JavaScript (in-memory aggregation)
-- never queries by source in SQL

DROP INDEX IF EXISTS ai_usage_source_idx;
