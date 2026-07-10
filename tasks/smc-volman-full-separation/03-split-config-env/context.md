# Context — Configuration Environment Split (Subtask 03)

## What Is This Subtask Part Of?

This is **Task 03 of 10** in the plan: **"Tách hoàn toàn SMC và Bob Volman thành 2 flow độc lập"**

Plan reference: `tasks/smc-volman-full-separation/plan.md`

---

## Current Architecture Problem

### Before (Monolithic)

```
chart-config-env.ts (single file)
    ├─ ChartTradingSystem type (runtime selection)
    ├─ getConfiguredChartTradingSystem() (runtime selection logic)
    │   └─ Returns "bob-volman" or "smc" based on ENV
    ├─ Shared config (engine mode, run context, timeframe)
    ├─ Volman config (confidence threshold)
    └─ SMC config (signal freshness, min confidence)

index.ts (Volman)          smc-index.ts (SMC)
    └─> Both import from same chart-config-env.ts
```

**Problem:** 
- Both entrypoints check `getConfiguredChartTradingSystem()` to know which system they are
- But the entrypoint is **already hardcoded** to be Volman or SMC
- This runtime check is unnecessary complexity
- Config is tangled: can't tell which settings apply to which system

### After (Separated)

```
volman-config-env.ts        smc-config-env.ts
    ├─ Shared functions     ├─ Shared functions
    │  (engine mode,        │  (engine mode,
    │   run context,        │   run context,
    │   timeframe)          │   timeframe)
    │                       │
    └─ Volman config        └─ SMC config
       (confidence)            (signal freshness,
                                min confidence)

index.ts (Volman)           smc-index.ts (SMC)
    └─> volman-config-env  └─> smc-config-env
```

**Benefits:**
- No runtime system selection needed
- Each entrypoint imports only what it uses
- Clear which settings belong to which system
- Types are type-safe (Volman config doesn't expose SMC functions)

---

## Key Decision: Shared vs Specific

### Shared Functions (Duplicated in Both Files)

These are used by both systems, so we include them in both files:

```
getConfiguredChartEngineMode()          — Engine mode (ai/deterministic/shadow)
getConfiguredChartTimeframeMode()       — Timeframe strategy (multi/single)
getConfiguredChartPrimaryTimeframe()    — Primary timeframe (M15/H4/D1)
getConfiguredChartRunContext()          — Run context (manual/auto from GitHub)
getConfiguredPendingOrderExpiryRuns()   — Pending order TTL
shouldUseLatestCacheForManualRun()      — Cache behavior
shouldSendHeartbeatOutsideCloseWindow() — Heartbeat timing
shouldSendHeartbeatOnManualRun()        — Heartbeat on manual
readBooleanEnv() [helper]               — Helper to parse boolean ENV
```

### Volman-Specific Functions

Only in `volman-config-env.ts`:

```
getConfiguredChartSignalConfidenceThreshold()  — Confidence threshold (default 70)
```

**ENV variables:**
- `CHART_SIGNAL_CONFIDENCE_THRESHOLD` — Volman confidence for setups

### SMC-Specific Functions

Only in `smc-config-env.ts`:

```
getConfiguredSmcSignalFreshnessCandles()  — How many candles old is still "fresh"
getConfiguredSmcMinSignalConfidence()     — Minimum confidence for SMC (default 65)
```

**ENV variables:**
- `SMC_SIGNAL_FRESHNESS_CANDLES` — Freshness window (1-20, default 1)
- `SMC_MIN_SIGNAL_CONFIDENCE` — Min confidence (0-100, default 65)

---

## Functions to Remove

### ChartTradingSystem Type

**Current code:**
```typescript
export type ChartTradingSystem = "bob-volman" | "smc";
```

**Action:** Delete this entirely — no longer needed.

### getConfiguredChartTradingSystem() Function

**Current code:**
```typescript
export function getConfiguredChartTradingSystem(): ChartTradingSystem {
  const raw = process.env.CHART_TRADING_SYSTEM?.trim().toLowerCase();
  if (raw === "bob-volman" || raw === "bob_volman") {
    return "bob-volman";
  }
  if (raw === "smc") {
    return "smc";
  }
  return "bob-volman";
}
```

**Action:** Delete entirely.

**Why?** Entrypoints are now hardcoded:
- `index.ts` is always Volman
- `smc-index.ts` is always SMC
- No runtime selection needed

**Existing usage:** Will be removed from:
- `index.ts` (remove `getConfiguredChartTradingSystem` import and calls)
- `smc-index.ts` (remove `getConfiguredChartTradingSystem` import and calls)

---

## Why Duplicate Shared Functions?

**Question:** Why not extract shared functions to a separate file?

**Answer for this task:** Keep it simple. Duplication is acceptable when:
- The duplicated code is small and stable (the shared config functions)
- Extraction would create coupling (a third file both depend on)
- Future benefit is unclear (might refactor more in next subtasks)

**If duplication becomes a problem in later tasks:**
- Extract to `chart-config-env-common.ts`
- Both volman and smc import from common
- But that's a future decision, not needed now

---

## Impact on Entrypoints

### index.ts (Volman)

**Before:**
```typescript
import {
  getConfiguredChartTradingSystem,  // Was reading ENV to decide system
  getConfiguredChartSignalConfidenceThreshold,
  // ...
} from "./chart-config-env.js";

// Later in code:
const tradingSystem = getConfiguredChartTradingSystem();  // Always "bob-volman"
```

**After:**
```typescript
import {
  getConfiguredChartSignalConfidenceThreshold,
  // ... (no getConfiguredChartTradingSystem)
} from "./volman-config-env.js";

// Later in code:
// No need to check system — we know we're Volman
```

### smc-index.ts (SMC)

**Before:**
```typescript
import {
  getConfiguredChartTradingSystem,  // Was reading ENV to decide system
  getConfiguredSmcMinSignalConfidence,
  // ...
} from "./chart-config-env.js";

// Later in code:
const tradingSystem = getConfiguredChartTradingSystem();  // Always "smc"
```

**After:**
```typescript
import {
  getConfiguredSmcMinSignalConfidence,
  // ... (no getConfiguredChartTradingSystem)
} from "./smc-config-env.js";

// Later in code:
// No need to check system — we know we're SMC
```

---

## Dependencies & Timing

**Depends on:** Task 02 (type splitting) — need to import from `chart-types-common.js`

**Blocks:** Task 04 (position engine split) — config will be split then

**Effort:** ~30 minutes

---

## Files to Modify

| File | Action | Why |
|------|--------|-----|
| `src/charts/volman-config-env.ts` | Create | New Volman config file |
| `src/charts/smc-config-env.ts` | Create | New SMC config file |
| `src/charts/index.ts` | Update imports | Change source from old to volman-config-env |
| `src/charts/smc-index.ts` | Update imports | Change source from old to smc-config-env |
| `src/charts/chart-config-env.ts` | Keep | Old file, will delete in task 10 |

---

## Cleanup in Task 10

**To be deleted in task 10:**
- `src/charts/chart-config-env.ts` (after all imports are migrated)

**Cannot delete now** because:
- Other code may still reference it
- Gradual migration happens in subsequent tasks
- Safer to delete after verifying no imports remain
