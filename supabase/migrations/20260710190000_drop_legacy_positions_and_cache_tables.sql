-- Legacy tables have been fully migrated to *_volman / *_smc tables
-- (see 20260710180000_split_positions_and_cache_tables.sql) and are no
-- longer referenced by any code. Drop them.
DROP TABLE IF EXISTS public.pending_orders;
DROP TABLE IF EXISTS public.open_positions;
DROP TABLE IF EXISTS public.chart_analysis_cache;
