# Subtask 04 Ready for Worker

**Date:** 2026-07-10  
**Status:** READY FOR WORKER  
**Prepared by:** Lead (Sonnet 5)

---

## What Has Been Prepared

### 1. Task Definition
- **File:** `tasks/smc-volman-full-separation/04-split-position-engine/task.md`
- **Content:** Step-by-step splitting instructions
- **Length:** ~250 lines with detailed checklist
- **Format:** Self-contained — Worker reads and executes

### 2. Context Document
- **File:** `tasks/smc-volman-full-separation/04-split-position-engine/context.md`
- **Content:** Background on position engine architecture, Volman vs SMC config functions
- **Optional reading:** Helps understand why splitting happens at this layer

### 3. Plan Reference
- **File:** `tasks/smc-volman-full-separation/plan.md`
- **Status:** Already exists, contains full project architecture

---

## What Subtask 04 Does

**Title:** Split Position Engine (Risk/Reward & Position Management)

**Input:**
- Monolithic `position-engine.ts` (405 lines)
- Used by both Volman and SMC pipelines
- Contains Volman-specific config functions + generic logic + obsolete system-selection logic

**Output:**
- `position-engine-volman.ts` — Volman-specific (keeps config functions)
- `position-engine-smc.ts` — SMC-specific (drops Volman config functions)
- Updated imports in entrypoints + positions-repository
- Updated test mocks
- Removed deriveSignalSystem() and SignalSystem type
- `result.md` with verification evidence

**What Gets Split:**

| Module | Volman | SMC | Notes |
|--------|--------|-----|-------|
| Type definitions | ✓ | ✓ | Duplicated (generic) |
| calculateRiskRewardPlan() | ✓ | ✓ | Generic math, both use |
| validateTradeSetupForOpen() | ✓ | ✓ | Generic validation |
| buildOpenPositionInsertRow() | ✓ | ✗ | Volman only |
| deriveManagementPatch() | ✓ | ✓ | Generic management |
| getConfiguredMinRiskRewardRatio() | ✓ | ✗ | Volman config only |
| getConfiguredTp1ClosePercent() | ✓ | ✗ | Volman config only |

**What Gets Deleted:**
- ~~SignalSystem type~~ (obsolete with hardcoded entrypoints)
- ~~deriveSignalSystem() function~~ (no longer needed)

**Key Decision:** Volman keeps config functions because `buildOpenPositionInsertRow()` depends on them. SMC drops them because it has its own risk model.

**Dependencies:**
- Task 02 (type splitting) ✓ Complete
- Task 03 (config splitting) ✓ Complete

**Effort:** ~35-40 minutes

---

## Checklist for Worker

- [ ] Create `position-engine-volman.ts` (copy all of position-engine.ts)
- [ ] Create `position-engine-smc.ts` (copy, but remove Volman config functions)
- [ ] Remove `SignalSystem` type from both
- [ ] Remove `deriveSignalSystem()` function from both
- [ ] Update `index.ts` imports (→ position-engine-volman.js)
- [ ] Update `smc-index.ts` imports (→ position-engine-smc.js)
- [ ] Remove `deriveSignalSystem()` calls from `positions-repository.ts`
- [ ] Update test mocks (index.test.ts, smc-index.test.ts)
- [ ] Run `npm run build` (should be clean)
- [ ] Run `npm run test` (should pass)
- [ ] Keep old `position-engine.ts` (don't delete)
- [ ] Record evidence in `result.md`

---

## Next Step for Worker

1. Open new chat in Claude Desktop with **Haiku** model
2. Copy this prompt:
   ```
   Acting as Worker.
   Đọc tasks/smc-volman-full-separation/04-split-position-engine/task.md
   Thực thi chính xác theo task
   Ghi kết quả vào tasks/smc-volman-full-separation/04-split-position-engine/result.md
   Không deviation, không thêm feature
   ```
3. Execute following `task.md` instructions

---

## Files Structure

```
tasks/smc-volman-full-separation/
├── plan.md                                    ← Full project plan
├── 01-db-split-tables/                        ← ✓ Completed
├── 02-shared-data-layer-and-types/            ← ✓ Completed
├── 03-split-config-env/                       ← ✓ Completed
├── 04-split-position-engine/                  ← CURRENT TASK
│   ├── task.md                                ← Read this
│   ├── context.md                             ← Optional reference
│   ├── result.md                              ← Output: fill this in
│   └── READY.md                               ← This file
├── 05-split-positions-repository/
│   ├── task.md
│   └── ...
└── ... (06-10)
```

---

## Key Insights For Worker

1. **Position engine is generic + config layer**
   - Generic: `calculateRiskRewardPlan()`, `validateTradeSetupForOpen()` work for any system
   - Volman config: `getConfiguredMinRiskRewardRatio()`, `getConfiguredTp1ClosePercent()`
   - SMC doesn't use Volman config (has its own risk model)

2. **Volman keeps config, SMC drops it**
   - `buildOpenPositionInsertRow()` uses config functions → Volman only
   - `deriveManagementPatch()` is generic → both have it

3. **Remove system derivation**
   - `SignalSystem` and `deriveSignalSystem()` no longer make sense
   - Entrypoint (index.ts or smc-index.ts) already knows which system it is

4. **Two identical copies with one difference**
   - Copy all of position-engine.ts into both volman and smc versions
   - SMC version: delete the 3 config functions
   - That's it—don't refactor, don't extract; just copy and delete

---

## Checklist for Lead

- [x] Analyzed position-engine.ts structure (405 lines)
- [x] Identified Volman-specific config functions
- [x] Identified generic functions (keep in both)
- [x] Identified obsolete system-derivation logic
- [x] Created complete `task.md` with detailed steps
- [x] Added context.md for background
- [x] Listed all import changes needed
- [x] Prepared verification steps
- [x] Ready to pass to Worker

**Status: READY FOR WORKER** ✅

---

## Estimated Timeline

- **Task 04 execution:** ~35-40 minutes (2 new files, 2-3 import updates, test fixes)
- **Build + test:** ~10 minutes
- **Review + merge:** ~30 minutes

**Total before Task 05:** ~2 hours

---

**Status: ✅ READY FOR WORKER**
