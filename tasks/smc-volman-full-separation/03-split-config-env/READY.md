# Subtask 03 Ready for Worker

**Date:** 2026-07-10  
**Status:** READY FOR WORKER  
**Prepared by:** Lead (Sonnet 5)

---

## What Has Been Prepared

### 1. Task Definition
- **File:** `tasks/smc-volman-full-separation/03-split-config-env/task.md`
- **Content:** Step-by-step instructions for config splitting
- **Length:** ~200 lines with code examples
- **Format:** Self-contained — Worker reads and executes

### 2. Context Document
- **File:** `tasks/smc-volman-full-separation/03-split-config-env/context.md`
- **Content:** Background on why config needs splitting, architecture decision
- **Optional reading:** Helps understand entrypoint simplification

### 3. Plan Reference
- **File:** `tasks/smc-volman-full-separation/plan.md`
- **Status:** Already exists, contains full project architecture

---

## What Subtask 03 Does

**Title:** Split Configuration Environment Files

**Input:**
- Monolithic `src/charts/chart-config-env.ts` with mixed config + runtime system selection
- Two entrypoints importing from same config file
- `ChartTradingSystem` type and `getConfiguredChartTradingSystem()` function (no longer needed)

**Output:**
- `src/charts/volman-config-env.ts` — Volman-specific config
- `src/charts/smc-config-env.ts` — SMC-specific config
- Updated entrypoint imports (index.ts, smc-index.ts)
- Removed `ChartTradingSystem` and `getConfiguredChartTradingSystem()`
- `result.md` with verification evidence

**Config Organization:**
- **Shared:** Engine mode, timeframe, run context, pending order expiry, heartbeat settings (duplicated in both)
- **Volman:** Confidence threshold (CHART_SIGNAL_CONFIDENCE_THRESHOLD)
- **SMC:** Signal freshness (SMC_SIGNAL_FRESHNESS_CANDLES), min confidence (SMC_MIN_SIGNAL_CONFIDENCE)

**Key Decision:** Remove runtime system selection — entrypoints are now hardcoded to their respective systems

**Dependencies:**
- Task 02 (type splitting) must be complete
- Imports new types from `chart-types-common.ts`

**Effort:** ~30-40 minutes (file creation + import updates + verification)

---

## Checklist for Worker

- [ ] Create `volman-config-env.ts` with Volman config + shared functions
- [ ] Create `smc-config-env.ts` with SMC config + shared functions
- [ ] Update `index.ts` imports (chart-config-env → volman-config-env)
- [ ] Update `smc-index.ts` imports (chart-config-env → smc-config-env)
- [ ] Remove all `getConfiguredChartTradingSystem()` calls
- [ ] Verify `ChartTradingSystem` type not used anywhere
- [ ] Run `npm run build` (should be clean)
- [ ] Run `npm run test` (should pass)
- [ ] Keep old `chart-config-env.ts` (don't delete)
- [ ] Record all evidence in `result.md`

---

## Next Step for Worker

1. Open new chat in Claude Desktop with **Haiku** model
2. Copy this prompt:
   ```
   Acting as Worker.
   Đọc tasks/smc-volman-full-separation/03-split-config-env/task.md
   Thực thi chính xác theo task
   Ghi kết quả vào tasks/smc-volman-full-separation/03-split-config-env/result.md
   Không deviation, không thêm feature
   ```
3. Execute following `task.md` instructions

---

## Files Structure

```
tasks/smc-volman-full-separation/
├── plan.md                                    ← Full project plan
├── 01-db-split-tables/                        ← Completed
│   ├── task.md
│   ├── result.md
│   └── ...
├── 02-shared-data-layer-and-types/            ← Completed
│   ├── task.md
│   ├── result.md
│   └── ...
├── 03-split-config-env/                       ← CURRENT TASK
│   ├── task.md                                ← Read this
│   ├── context.md                             ← Optional reference
│   ├── result.md                              ← Output: fill this in
│   └── READY.md                               ← This file
├── 04-split-position-engine/
│   ├── task.md
│   └── ...
└── ... (05-10)
```

---

## Checklist for Lead

- [x] Analyzed chart-config-env.ts structure
- [x] Identified Volman vs SMC vs shared config
- [x] Analyzed entrypoint imports (index.ts, smc-index.ts)
- [x] Identified functions to remove (ChartTradingSystem, getConfiguredChartTradingSystem)
- [x] Created complete `task.md` with code examples
- [x] Added context.md for background
- [x] Listed all import changes needed
- [x] Prepared verification steps
- [x] Ready to pass to Worker

**Status: READY FOR WORKER** ✅

---

## Key Decisions Made

1. **Duplicate shared functions** — Simple for now, can extract later if needed
2. **Remove runtime system selection** — No longer needed with hardcoded entrypoints
3. **Keep old file** — Gradual migration in tasks 03-09, delete in task 10
4. **Both Volman and SMC get same shared functions** — Ensures consistency

---

## Estimated Timeline

- **Task 03 execution:** ~30-40 minutes (2 new files, 2 import updates, verification)
- **Build + test:** ~10 minutes
- **Review + merge:** ~30 minutes

**Total before Task 04:** ~1.5-2 hours

---

**Status: ✅ READY FOR WORKER**
