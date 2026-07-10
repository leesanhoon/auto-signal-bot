# Task 01 — DB Split Tables: Create 6 New Tables, Migrate Data, Keep Old Tables

**Subtask ID:** `01-db-split-tables`  
**Date:** 2026-07-10  
**Worker:** Haiku  

---

## Objective

Create 6 new database tables (split by system: Volman & SMC), migrate data from the old shared tables using the existing `system` column, and keep the old tables intact for backward compatibility during transition.

## Current Schema

From recent migrations, the database has:
- `open_positions` — has `system` column (default 'volman')
- `pending_orders` — has `system` column (default 'volman')  
- `chart_analysis_cache` — no `system` column; uses `candle_key` suffix to distinguish (`:smc` or `:deterministic`)

### Step 1: Inspect Current Data (Verification Only)

Before making any changes, run these queries to understand current data distribution. Record the results in `result.md`.

**Queries to run:**

```sql
-- Check data in open_positions by system
SELECT system, COUNT(*) as count FROM open_positions GROUP BY system;

-- Check data in pending_orders by system
SELECT system, COUNT(*) as count FROM pending_orders GROUP BY system;

-- Check candle_key patterns in chart_analysis_cache
SELECT 
  CASE 
    WHEN candle_key LIKE '%:smc' THEN 'smc'
    WHEN candle_key LIKE '%:deterministic' THEN 'deterministic (volman)'
    ELSE 'other'
  END as source,
  COUNT(*) as count
FROM chart_analysis_cache
GROUP BY 1
ORDER BY source;

-- Show table schema
\d+ open_positions;
\d+ pending_orders;
\d+ chart_analysis_cache;
```

**Save the output to `result.md` section: "## Pre-Migration Data"**

---

### Step 2a: Get Complete Schema Definitions

Before creating the migration, extract the complete schema from the existing tables:

```sql
-- Get CREATE TABLE statement for open_positions (can use this as template)
SELECT pg_get_create_tablestmt('open_positions'::regclass);

-- Get all indexes on open_positions
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'open_positions';

-- Get all FK constraints
SELECT constraint_name, table_name, column_name, foreign_table_name, foreign_column_name
FROM information_schema.key_column_usage
WHERE table_name IN ('open_positions', 'pending_orders', 'chart_analysis_cache');
```

Save this output — you'll use it to create the new tables in Step 2b.

### Step 2b: Create Migration File

Create a new migration file: `supabase/migrations/20260710180000_split_positions_and_cache_tables.sql`

This migration must:

1. **Create 3 new tables for Volman system:**
   - `open_positions_volman` — copy structure from `open_positions` (minus the `system` column)
   - `pending_orders_volman` — copy structure from `pending_orders` (minus the `system` column)
   - `analysis_cache_volman` — copy structure from `chart_analysis_cache`

2. **Create 3 new tables for SMC system:**
   - `open_positions_smc` — copy structure from `open_positions` (minus the `system` column)
   - `pending_orders_smc` — copy structure from `pending_orders` (minus the `system` column)
   - `analysis_cache_smc` — copy structure from `chart_analysis_cache`

3. **Migrate data** from old tables to new tables using INSERT INTO ... SELECT filtered by `system` column (or candle_key pattern for cache)

   **Pattern for `open_positions_volman`:**
   ```sql
   INSERT INTO open_positions_volman 
   SELECT id, pair, direction, ... (all columns EXCEPT system) 
   FROM open_positions 
   WHERE system = 'volman' OR system IS NULL;
   ```

   **Pattern for `open_positions_smc`:**
   ```sql
   INSERT INTO open_positions_smc 
   SELECT id, pair, direction, ... (all columns EXCEPT system) 
   FROM open_positions 
   WHERE system = 'smc';
   ```

   **Pattern for `analysis_cache_volman`:**
   ```sql
   INSERT INTO analysis_cache_volman 
   SELECT candle_key, result, created_at 
   FROM chart_analysis_cache 
   WHERE candle_key NOT LIKE '%:smc';
   ```

   **Pattern for `analysis_cache_smc`:**
   ```sql
   INSERT INTO analysis_cache_smc 
   SELECT candle_key, result, created_at 
   FROM chart_analysis_cache 
   WHERE candle_key LIKE '%:smc';
   ```

4. **Do NOT drop old tables** — keep them for backward compatibility during the transition phase.

5. **Recreate indexes** on the new tables. Reference the original indexes from:
   ```sql
   \d+ open_positions;      -- to see existing indexes
   \d+ pending_orders;      -- to see existing indexes
   \d+ chart_analysis_cache;-- to see existing indexes
   ```

### Important Notes on Foreign Keys

- `pending_orders.triggered_position_id` references `open_positions.id` (in old table)
- After splitting tables, the new `pending_orders_volman` and `pending_orders_smc` will reference their respective `open_positions_volman` and `open_positions_smc`
- The migration must recreate these FK constraints appropriately. Example:
  ```sql
  ALTER TABLE pending_orders_volman
  ADD CONSTRAINT fk_pending_orders_volman_position 
  FOREIGN KEY (triggered_position_id) 
  REFERENCES open_positions_volman(id);
  ```

---

### Step 3: Apply Migration

Run:
```bash
supabase migration list
supabase db push
```

After applying, verify all 6 new tables exist with correct schema, FK, and indexes.

---

### Step 4: Verify Data Migration

Run these verification queries (record ALL results in `result.md`):

```sql
-- 1. Verify row count totals match
SELECT 'open_positions' as table_name, COUNT(*) as old_count FROM open_positions
UNION ALL
SELECT 'open_positions_volman', COUNT(*) FROM open_positions_volman
UNION ALL
SELECT 'open_positions_smc', COUNT(*) FROM open_positions_smc;

SELECT 'pending_orders' as table_name, COUNT(*) as old_count FROM pending_orders
UNION ALL
SELECT 'pending_orders_volman', COUNT(*) FROM pending_orders_volman
UNION ALL
SELECT 'pending_orders_smc', COUNT(*) FROM pending_orders_smc;

SELECT 'chart_analysis_cache' as table_name, COUNT(*) as old_count FROM chart_analysis_cache
UNION ALL
SELECT 'analysis_cache_volman', COUNT(*) FROM analysis_cache_volman
UNION ALL
SELECT 'analysis_cache_smc', COUNT(*) FROM analysis_cache_smc;

-- 2. Verify ForeignKey constraints exist
SELECT constraint_name, table_name 
FROM information_schema.table_constraints 
WHERE constraint_type = 'FOREIGN KEY' 
  AND table_name IN ('pending_orders_volman', 'pending_orders_smc');

-- 3. Verify indexes were recreated
SELECT indexname FROM pg_indexes WHERE tablename IN 
  ('open_positions_volman', 'open_positions_smc', 
   'pending_orders_volman', 'pending_orders_smc',
   'analysis_cache_volman', 'analysis_cache_smc');

-- 4. Verify old tables still exist
SELECT tablename FROM pg_tables 
WHERE tablename IN ('open_positions', 'pending_orders', 'chart_analysis_cache')
  AND schemaname = 'public';

-- 5. Spot-check data integrity (sample a few rows)
SELECT 'old_open_positions' as source, id, pair, direction FROM open_positions LIMIT 3
UNION ALL
SELECT 'new_volman', id, pair, direction FROM open_positions_volman LIMIT 3
UNION ALL
SELECT 'new_smc', id, pair, direction FROM open_positions_smc LIMIT 3;
```

Record ALL output with clear section headers like "## Verification Results"

---

## Migration SQL Template Structure

Your migration file should follow this pattern:

```sql
-- 1. Create new tables (copy schema from originals, remove `system` column)
CREATE TABLE IF NOT EXISTS public.open_positions_volman (
  -- Copy all columns from open_positions EXCEPT system column
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair text NOT NULL,
  -- ... all other columns ...
  CONSTRAINT valid_open_positions_volman_direction CHECK (direction IN ('LONG', 'SHORT')),
  CONSTRAINT valid_open_positions_volman_status CHECK (status IN ('open', 'closed', 'pending'))
);

-- Repeat for: pending_orders_volman, analysis_cache_volman, 
--             open_positions_smc, pending_orders_smc, analysis_cache_smc

-- 2. Migrate data from old tables to new tables
INSERT INTO open_positions_volman (id, pair, direction, ...)
SELECT id, pair, direction, ...
FROM open_positions 
WHERE system = 'volman' OR system IS NULL;

INSERT INTO open_positions_smc (id, pair, direction, ...)
SELECT id, pair, direction, ...
FROM open_positions 
WHERE system = 'smc';

-- ... repeat for pending_orders and cache tables ...

-- 3. Recreate indexes
CREATE INDEX idx_open_positions_volman_pair_status 
  ON open_positions_volman(pair, status);
-- ... recreate all other indexes ...

-- 4. Recreate foreign key constraints
ALTER TABLE pending_orders_volman
ADD CONSTRAINT fk_pending_orders_volman_position 
FOREIGN KEY (triggered_position_id) REFERENCES open_positions_volman(id);

ALTER TABLE pending_orders_smc
ADD CONSTRAINT fk_pending_orders_smc_position 
FOREIGN KEY (triggered_position_id) REFERENCES open_positions_smc(id);

-- 5. DO NOT drop old tables — keep for backward compatibility
-- (They will be dropped in a separate cleanup migration after code deployment)
```

---

## Expected Output

Create `tasks/smc-volman-full-separation/01-db-split-tables/result.md` with:

### Section 1: Migration File Created
- Path: `supabase/migrations/20260710180000_split_positions_and_cache_tables.sql`
- Confirmation it was created

### Section 2: Pre-Migration Data
- Output from Step 1 queries (row counts by system)

### Section 3: Migration Applied
- Output from `supabase migration list` (showing new migration)
- Output from `supabase db push` (successful application)

### Section 4: Post-Migration Verification
- All 6 new tables exist (list them)
- Row count verification (old total = new_volman + new_smc)
- Foreign key constraints exist
- Indexes recreated successfully
- Old tables still exist

### Section 5: Data Integrity Check
- Sample rows from old and new tables showing data matches
- Confirmation no data loss occurred

---

## No Build/Test Required

This is pure DB migration — no TypeScript code changes, so skip `npm run build` and `npm run test`.

The migration is complete once `supabase db push` succeeds and all verification queries pass.
