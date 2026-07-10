-- ============================================================================
-- Migration: Drop Legacy Positions Tables
-- Date: 2026-07-10
-- ============================================================================
--
-- ⚠️ DESTRUCTIVE OPERATION — DATA LOSS
-- This migration drops the old unified positions and chart analysis tables.
--
-- IMPORTANT: This migration must ONLY be applied to production AFTER:
-- 1. Verifying that all data has been successfully migrated to the new schema
--    (open_positions_volman, pending_orders_volman, chart_analysis_cache_volman for Volman system)
--    (open_positions_smc, pending_orders_smc, chart_analysis_cache_smc for SMC system)
-- 2. Reconciling the row counts between old and new tables to ensure no data loss
-- 3. Confirming that no application code still references these tables
--
-- See: tasks/smc-volman-full-separation/01-db-split-tables/done.md for data migration details
--      tasks/smc-volman-full-separation/plan.md for the full separation context
-- ============================================================================

-- Drop the old unified positions and cache tables
DROP TABLE IF EXISTS open_positions;
DROP TABLE IF EXISTS pending_orders;
DROP TABLE IF EXISTS chart_analysis_cache;
