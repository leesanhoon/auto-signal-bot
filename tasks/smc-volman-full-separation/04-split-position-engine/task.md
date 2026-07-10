# Task 04 — Split Position Engine

**Subtask ID:** `04-split-position-engine`  
**Date:** 2026-07-10  
**Worker:** Haiku  
**Dependencies:** Task 02 (type splitting) and Task 03 (config splitting) must be complete

---

## Objective

Split `position-engine.ts` into two system-specific position engine files:
1. `position-engine-volman.ts` — Volman-specific position logic
2. `position-engine-smc.ts` — SMC-specific position logic

Remove the runtime system selection logic (`SignalSystem`, `deriveSignalSystem`) since each entrypoint now imports its own engine.

---

## Background

### Current Problem

`position-engine.ts` contains:
- **Volman-specific config functions:** `getConfiguredMinRiskRewardRatio()`, `getConfiguredTp1ClosePercent()`, etc.
- **Generic position logic:** Risk/reward calculation, trade setup validation, position management
- **Runtime system selection:** `SignalSystem` type and `deriveSignalSystem()` function to determine which system owns a trade

**Issue:** Both Volman and SMC import from same file, but:
1. Volman config functions are Volman-specific (read POSITION_MIN_RISK_REWARD_RATIO env var)
2. SMC doesn't use these functions (has different risk/reward model)
3. `deriveSignalSystem()` is no longer needed (system is known at import time)

### Why Split?

1. **Type safety:** Each system knows what functions it actually uses
2. **Clarity:** No ambiguity about which config functions apply to which system
3. **Independence:** Volman can evolve its risk/reward logic independently from SMC
4. **Removal of unnecessary logic:** `deriveSignalSystem()` becomes obsolete

---

## Task Steps

### Step 1: Create `position-engine-volman.ts`

**Location:** `src/charts/position-engine-volman.ts`

**Contains:** Copy entire `position-engine.ts` including:
- All type definitions (PositionDecisionAction, PositionDecisionOutcome, RiskRewardPlan, etc.)
- All generic functions (calculateRiskRewardPlan, validateTradeSetupForOpen, etc.)
- **Volman-specific functions:**
  - `getConfiguredMinRiskRewardRatio()`
  - `getConfiguredMinRiskRewardRatioForPattern()`
  - `getConfiguredTp1ClosePercent()`
- All internal helper functions (parsePrice, clampPercent, etc.)

**Remove:**
- ~~`export type SignalSystem`~~ ✗ Delete
- ~~`export function deriveSignalSystem()`~~ ✗ Delete

**Key note:** This version keeps Volman-specific config because Volman pipeline uses `buildOpenPositionInsertRow()` which calls these config functions.

### Step 2: Create `position-engine-smc.ts`

**Location:** `src/charts/position-engine-smc.ts`

**Contains:** Same as Volman version EXCEPT:
- Remove **Volman-specific config functions:**
  - ~~`getConfiguredMinRiskRewardRatio()`~~ ✗ Delete
  - ~~`getConfiguredMinRiskRewardRatioForPattern()`~~ ✗ Delete
  - ~~`getConfiguredTp1ClosePercent()`~~ ✗ Delete

**Why?** SMC doesn't use position-engine functions for risk/reward calculation. SMC builds its own risk/reward model directly in the SMC pipeline.

### Step 3: Keep Old File (Do NOT Delete)

**File:** `src/charts/position-engine.ts`  
**Status:** Keep unchanged for now

**Reason:** Some code may still reference it. Will be removed in task 10 after all imports are updated.

### Step 4: Update Imports in Using Code

Search for imports from `position-engine.ts`:

```bash
grep -r "from.*position-engine.js" src/charts/ tests/
```

Expected to update:
- `index.ts` (Volman) — change to `position-engine-volman.js`
- `smc-index.ts` (SMC) — change to `position-engine-smc.js`
- Test files — update mocks accordingly

**Check what each file imports:**
- If it imports `deriveSignalSystem` → needs to be removed
- If it imports `SignalSystem` → type no longer needed
- If it imports config functions → verify it matches the system

### Step 5: Remove deriveSignalSystem Calls

Search for all calls to `deriveSignalSystem()`:

```bash
grep -r "deriveSignalSystem" src/charts/
```

**Expected locations:** `positions-repository.ts` uses it for dedup/filtering

**Action:** Remove the calls since each repository will be split in a later task (and won't need to check system anymore — they'll be system-specific).

### Step 6: Update Test Mocks

Test files mocking position-engine need to point to correct files:
- `tests/charts/index.test.ts` → mock `position-engine-volman.js`
- `tests/charts/smc-index.test.ts` → mock `position-engine-smc.js`

Remove mocks for:
- ~~`deriveSignalSystem`~~ (no longer exported)
- ~~`SignalSystem`~~ (type no longer needed)

### Step 7: Verify Build & Tests

**Run:**
```bash
npm run build
npm run test
```

**Expected:**
- ✅ No TypeScript errors
- ✅ No import errors (all functions found in correct system-specific files)
- ✅ Tests pass without changes (mocks updated)
- ✅ No references to `deriveSignalSystem` remain in code
- ✅ No references to `SignalSystem` type remain in code

---

## Checklist

- [ ] Created `position-engine-volman.ts` with Volman config functions
- [ ] Created `position-engine-smc.ts` without Volman config functions
- [ ] Removed `SignalSystem` type (not in either new file)
- [ ] Removed `deriveSignalSystem()` function (not in either new file)
- [ ] Updated `index.ts` imports (→ position-engine-volman.js)
- [ ] Updated `smc-index.ts` imports (→ position-engine-smc.js)
- [ ] Removed all `deriveSignalSystem()` calls from code
- [ ] Updated test mocks (index.test.ts, smc-index.test.ts)
- [ ] Ran `npm run build` successfully
- [ ] Ran `npm run test` successfully
- [ ] No TypeScript errors
- [ ] No import errors
- [ ] Old `position-engine.ts` still exists (for task 10 cleanup)

---

## Expected Output

Create `tasks/smc-volman-full-separation/04-split-position-engine/result.md` with:

1. **Files created:**
   - `src/charts/position-engine-volman.ts` — line count, functions exported
   - `src/charts/position-engine-smc.ts` — line count, functions exported

2. **Files updated:**
   - `src/charts/index.ts` — import changes
   - `src/charts/smc-index.ts` — import changes
   - `src/charts/positions-repository.ts` — deriveSignalSystem call removal
   - Test files updated with new mocks

3. **Code removed:**
   - `SignalSystem` type (line in old file)
   - `deriveSignalSystem()` function (line in old file)
   - All calls to `deriveSignalSystem()` (list files where removed)

4. **Build verification:**
   - `npm run build` output (should be clean)
   - `npm run test` output (summary of passed tests)
   - List of any TypeScript errors (should be none)

5. **Verification:**
   - Confirmation that old `position-engine.ts` still exists
   - No remaining references to `SignalSystem`
   - No remaining references to `deriveSignalSystem()`

---

## Important Notes

⚠️ **Do NOT delete old `position-engine.ts`** — keep for task 10 cleanup

✅ **Volman version keeps config functions** — needed for `buildOpenPositionInsertRow()`

✅ **SMC version drops config functions** — SMC has different risk/reward model

✅ **Both versions keep generic functions** — `calculateRiskRewardPlan()`, `validateTradeSetupForOpen()`, etc. are generic

✅ **Remove system derivation logic** — no longer needed with hardcoded entrypoints

---

## File Structure Overview

### position-engine-volman.ts (keep all these)
```
Types (generic):
  PositionDecisionAction
  PositionDecisionOutcome
  RiskRewardPlan
  OpenPositionManagementPatch
  DeriveManagementPatchOptions
  OpenPositionValidation

Functions (generic):
  parsePrice() [helper]
  clampPercent() [helper]
  clampRiskReward() [helper]
  validateOrderTypeForDirection() [helper]
  calculateRiskRewardPlan()
  validateTradeSetupForOpen()
  buildOpenPositionInsertRow()
  deriveManagementPatch()

Functions (Volman-specific config):
  getConfiguredMinRiskRewardRatio()
  getConfiguredMinRiskRewardRatioForPattern()
  getConfiguredTp1ClosePercent()
```

### position-engine-smc.ts (same as above but WITHOUT config functions)
```
Same types and generic functions as Volman

REMOVE:
  getConfiguredMinRiskRewardRatio()
  getConfiguredMinRiskRewardRatioForPattern()
  getConfiguredTp1ClosePercent()
```

### Functions to DELETE (from both)
```
SignalSystem type
deriveSignalSystem() function
```

---

## No Database Changes This Step

This is pure TypeScript code reorganization. No database changes.
