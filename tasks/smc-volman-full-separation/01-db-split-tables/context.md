# Context — SMC/Volman Full Separation

## What Is This Subtask Part Of?

This is **Task 01 of 10** in the larger plan: **"Tách hoàn toàn SMC và Bob Volman thành 2 flow độc lập"**

Plan reference: `tasks/smc-volman-full-separation/plan.md`

---

## Why Are We Splitting Tables?

Currently:
- `open_positions` table stores both Volman and SMC trades
- Uses a `system` column (values: `'volman'` or `'smc'`) added in recent migration
- Same for `pending_orders` and `chart_analysis_cache` tables

**Problem:** Shared table means:
- Code paths are tangled (need to filter by system everywhere)
- Risk of bugs: SMC entrypoint might accidentally read Volman data
- Schema must accommodate both systems' needs (harder to evolve independently)

**Solution:** Split into 6 independent tables:
- `open_positions_volman` / `open_positions_smc`
- `pending_orders_volman` / `pending_orders_smc`
- `analysis_cache_volman` / `analysis_cache_smc`

This subtask does the database migration. Subsequent subtasks will:
- Rewrite TypeScript code to use the new tables
- Remove `system` column logic from code
- Make each system 100% independent

---

## Architecture Decision: Keep Old Tables During Transition

**Why NOT drop old tables immediately?**
- Entrypoints (`index.ts`, `smc-index.ts`) are deployed to production and run on cron jobs
- Code changes (subtasks 02-10) will take days/weeks to complete
- If we drop old tables now and code changes fail, production cron jobs crash
- **Solution:** Keep old tables during transition, drop them in final cleanup (part of subtask 10)

**Timeline:**
1. **This task (01):** Create new tables, migrate data, keep old tables
2. **Tasks 02-09:** Rewrite code to use new tables, test locally
3. **Task 10:** Update entrypoints, verify everything works
4. **After 10 merges to main & deploys:** Drop old tables safely

---

## System Column Value Distribution

From plan.md table: data was marked with `system = 'volman'` by default in recent migration.

Expected:
- Most rows: `system = 'volman'` (existing Volman trades)
- Some rows: `system = 'smc'` (if any SMC trades were recorded)
- Some rows: `system IS NULL` (very old rows from before system column was added)

**Your job:** Verify actual distribution before migration, then migrate correctly.

---

## Foreign Key Constraint: pending_orders → open_positions

Important: `pending_orders.triggered_position_id` references `open_positions(id)`

After split:
- `pending_orders_volman.triggered_position_id` → `open_positions_volman.id`
- `pending_orders_smc.triggered_position_id` → `open_positions_smc.id`

Must recreate these FK constraints in the new tables.

---

## Files Not Touched This Subtask

- TypeScript source code (no changes yet)
- Tests (no changes yet)
- Entrypoints (will be rewired in subtask 10)

Only SQL migrations in `supabase/migrations/`.

---

## Success Criteria

Migration is complete when:
1. ✅ All 6 new tables exist with correct schema
2. ✅ Data migrated (old row count = new volman + new smc)
3. ✅ Foreign keys recreated
4. ✅ Indexes recreated
5. ✅ Old tables still exist (not dropped)
6. ✅ `result.md` records all evidence

See `task.md` Step 4 for exact verification queries to run.
