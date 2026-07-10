# Subtask 01 Ready for Worker

**Date:** 2026-07-10  
**Status:** READY FOR WORKER  
**Prepared by:** Lead (Sonnet 5)

---

## What Has Been Prepared

### 1. Task Definition
- **File:** `tasks/smc-volman-full-separation/01-db-split-tables/task.md`
- **Content:** Complete executable instructions for Worker
- **Length:** ~200 lines with detailed SQL examples
- **Format:** Self-contained — Worker reads this one file and executes

### 2. Context Document
- **File:** `tasks/smc-volman-full-separation/01-db-split-tables/context.md`
- **Content:** Background on why this task exists, architecture decisions
- **Optional reading:** Helps Worker understand the larger project context

### 3. Plan Reference
- **File:** `tasks/smc-volman-full-separation/plan.md`
- **Status:** Already exists, contains full project architecture

---

## What Subtask 01 Does

**Title:** DB Split Tables: Create 6 New Tables, Migrate Data, Keep Old Tables

**Input:**
- Current database has 3 tables with mixed Volman/SMC data
- `open_positions` (has `system` column)
- `pending_orders` (has `system` column)
- `chart_analysis_cache` (uses candle_key suffix to distinguish)

**Output:**
- 6 new tables: `*_volman` and `*_smc` variants
- Data migrated from old tables to new tables based on `system` column
- Old tables remain for backward compatibility
- `result.md` with verification evidence

**Dependencies:** None (can start immediately)

---

## Next Step for Worker

1. Open a new chat in Claude Desktop
2. Set model to **Haiku** (or GPT-5.4-mini for Codex)
3. Copy this prompt:
   ```
   Acting as Worker.
   Đọc tasks/smc-volman-full-separation/01-db-split-tables/task.md
   Thực thi chính xác theo task
   Ghi kết quả vào tasks/smc-volman-full-separation/01-db-split-tables/result.md
   Không deviation, không thêm feature
   ```
4. Execute the task following `task.md` instructions

---

## Files Structure

```
tasks/smc-volman-full-separation/
├── plan.md                           ← Full project plan (10 subtasks)
├── 01-db-split-tables/
│   ├── task.md                       ← MAIN: Read this
│   ├── context.md                    ← Optional: Project context
│   ├── result.md                     ← Output: Worker fills this
│   └── blocked.md                    ← If blocked: Worker creates this
├── 02-shared-data-layer-and-types/
│   ├── task.md
│   └── ...
└── ... (03-10)
```

---

## Checklist for Lead

- [x] Analyzed current schema and migration history
- [x] Created complete `task.md` with step-by-step instructions
- [x] Added SQL examples for each migration step
- [x] Included verification queries
- [x] Documented schema template pattern
- [x] Created context.md for background
- [x] Ready to pass to Worker

**Status: READY FOR WORKER** ✅
