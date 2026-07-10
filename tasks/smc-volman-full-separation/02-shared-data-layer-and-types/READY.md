# Subtask 02 Ready for Worker

**Date:** 2026-07-10  
**Status:** READY FOR WORKER  
**Prepared by:** Lead (Sonnet 5)

---

## What Has Been Prepared

### 1. Task Definition
- **File:** `tasks/smc-volman-full-separation/02-shared-data-layer-and-types/task.md`
- **Content:** Complete step-by-step instructions
- **Length:** ~250 lines with detailed type examples
- **Format:** Self-contained — Worker reads and executes

### 2. Context Document
- **File:** `tasks/smc-volman-full-separation/02-shared-data-layer-and-types/context.md`
- **Content:** Background on type splitting strategy
- **Optional reading:** Helps understand the larger architecture

### 3. Plan Reference
- **File:** `tasks/smc-volman-full-separation/plan.md`
- **Status:** Already exists, contains full project architecture

---

## What Subtask 02 Does

**Title:** Shared Data Layer & Type Splitting

**Input:**
- Monolithic `src/charts/chart-types.ts` with mixed Volman/SMC types
- Stale documentation (MetaApi reference)
- Working OHLC provider (should remain unchanged)

**Output:**
- 3 new files: `chart-types-common.ts`, `chart-types-volman.ts`, `chart-types-smc.ts`
- Updated documentation (MetaApi → TwelveData)
- Old `chart-types.ts` kept for now (backward compatibility)
- `result.md` with verification evidence

**Type Organization:**
- **Common:** Infrastructure types (OHLC, charts, orders) — both systems use
- **Volman:** Business types for Volman system (TradeSetup with emaTouch, entryCondition)
- **SMC:** Business types for SMC system (TradeSetup with grade, score, liquidityTargets)

**Key Decision:** OHLC provider stays shared (both systems read same price data)

**Dependencies:**
- Task 01 (DB split) should be merged — but this task doesn't depend on it directly
- Can start immediately after Lead prepares task.md

**Effort:** ~45 minutes (file creation + build verification)

---

## Checklist for Worker

- [ ] Create `chart-types-common.ts` with infrastructure types
- [ ] Create `chart-types-volman.ts` with Volman-specific types
- [ ] Create `chart-types-smc.ts` with SMC-specific types
- [ ] Verify OHLC files unchanged
- [ ] Update documentation (MetaApi → TwelveData)
- [ ] Run `npm run build` (should be clean)
- [ ] Run `npm run test` (should pass)
- [ ] Keep old `chart-types.ts` (don't delete)
- [ ] Update test imports as needed
- [ ] Record all evidence in `result.md`

---

## Next Step for Worker

1. Open new chat in Claude Desktop with **Haiku** model
2. Copy this prompt:
   ```
   Acting as Worker.
   Đọc tasks/smc-volman-full-separation/02-shared-data-layer-and-types/task.md
   Thực thi chính xác theo task
   Ghi kết quả vào tasks/smc-volman-full-separation/02-shared-data-layer-and-types/result.md
   Không deviation, không thêm feature
   ```
3. Execute following `task.md` instructions

---

## Files Structure

```
tasks/smc-volman-full-separation/
├── plan.md                                          ← Full project plan
├── 01-db-split-tables/                              ← Completed
│   ├── task.md
│   ├── result.md
│   ├── context.md
│   └── READY.md
├── 02-shared-data-layer-and-types/                 ← CURRENT TASK
│   ├── task.md                                      ← Read this
│   ├── context.md                                   ← Optional reference
│   ├── result.md                                    ← Output: fill this in
│   └── READY.md                                     ← This file
├── 03-split-config-env/
│   ├── task.md
│   └── ...
└── ... (04-10)
```

---

## Checklist for Lead

- [x] Analyzed current chart-types.ts structure
- [x] Identified Volman-specific vs SMC-specific fields
- [x] Created complete `task.md` with type examples
- [x] Added context.md for background
- [x] Listed all files to create/modify/verify
- [x] Prepared documentation fix (MetaApi → TwelveData)
- [x] Ready to pass to Worker

**Status: READY FOR WORKER** ✅

---

## Key Decisions Made

1. **Split types, not code** — Only reorganize type definitions, no logic changes
2. **Keep OHLC shared** — Both systems use same price data source
3. **Keep old file** — Gradual migration in tasks 03-09, delete in task 10
4. **Fix doc now** — Update stale MetaApi reference while editing

---

## Estimated Timeline

- **Task 02 execution:** ~45 minutes
- **Build + test:** ~15 minutes
- **Review + merge:** ~30 minutes

**Total before Task 03:** ~1.5 hours

---

**Status: ✅ READY FOR WORKER**
