# Task 03 — Split Configuration Environment Files

**Subtask ID:** `03-split-config-env`  
**Date:** 2026-07-10  
**Worker:** Haiku  
**Dependencies:** Task 02 (type splitting) must be complete

---

## Objective

Split `chart-config-env.ts` into two system-specific configuration files:
1. `volman-config-env.ts` — Volman-specific configuration
2. `smc-config-env.ts` — SMC-specific configuration

Remove the runtime system selection logic (`ChartTradingSystem`, `getConfiguredChartTradingSystem`) since entrypoints are now hardcoded to their respective systems.

---

## Background

### Current Problem

`chart-config-env.ts` contains a mix of:
- **Shared config:** Engine mode, timeframe settings, run context
- **Volman-specific config:** Confidence threshold, position risk/reward settings
- **SMC-specific config:** Signal freshness, minimum confidence for SMC

**Additional problem:** File contains `ChartTradingSystem` type and `getConfiguredChartTradingSystem()` function that allows runtime selection of which system to use. Since we're now running **separate entrypoints** (`index.ts` for Volman, `smc-index.ts` for SMC), we don't need runtime system selection anymore.

### Why Split?

1. **Clarity:** Each system's config is isolated, obvious which settings apply to which system
2. **Independence:** Volman can add its own config without affecting SMC
3. **Simplicity:** Remove `ChartTradingSystem` runtime selection (now unnecessary)
4. **Type safety:** Volman config doesn't expose SMC functions and vice versa

### New Architecture

```
index.ts (Volman)
    └─> volman-config-env.ts (Volman config only)

smc-index.ts (SMC)
    └─> smc-config-env.ts (SMC config only)

Both systems (if needed shared config)
    └─> Inline or shared helper (ChartTimeframe, run context, etc.)
```

**Decision:** For now, duplicate the shared functions in both files. Future: if shared config becomes large, extract to `chart-config-env-common.ts`.

---

## Task Steps

### Step 1: Create `volman-config-env.ts`

**Location:** `src/charts/volman-config-env.ts`

**Contains:** Volman-specific configuration reading

```typescript
import type { ChartEngineMode, ChartRunContext, ChartTimeframeMode } from "./chart-types-common.js";
import type { ChartTimeframe } from "./chart-types-common.js";

// ============================================================================
// Shared helpers (duplicated in both volman-config-env.ts and smc-config-env.ts)
// ============================================================================

function readBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

// ============================================================================
// Shared configuration (both Volman and SMC use these)
// ============================================================================

export function getConfiguredChartEngineMode(): ChartEngineMode {
  return "deterministic";
}

export function getConfiguredChartTimeframeMode(): ChartTimeframeMode {
  const raw = process.env.CHART_TIMEFRAME_MODE?.trim().toLowerCase();
  if (raw === "multi" || raw === "single") {
    return raw;
  }
  return "multi";
}

export function getConfiguredChartPrimaryTimeframe(): ChartTimeframe {
  const raw = process.env.CHART_PRIMARY_TIMEFRAME?.trim().toUpperCase();
  if (raw === "M15" || raw === "H4" || raw === "D1") {
    return raw as ChartTimeframe;
  }
  return "M15";
}

export function getConfiguredChartRunContext(): ChartRunContext {
  const override = process.env.CHART_RUN_CONTEXT?.trim().toLowerCase();
  if (override === "manual" || override === "auto") {
    return override as ChartRunContext;
  }

  const githubEventName = process.env.GITHUB_EVENT_NAME?.trim().toLowerCase();
  if (githubEventName === "schedule") {
    return "auto";
  }
  if (githubEventName === "workflow_dispatch") {
    return "manual";
  }

  return "manual";
}

export function getConfiguredPendingOrderExpiryRuns(): number {
  const raw = process.env.PENDING_ORDER_EXPIRY_RUNS?.trim();
  if (!raw) return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
}

export function shouldUseLatestCacheForManualRun(): boolean {
  return readBooleanEnv("CHART_HEARTBEAT_USE_LATEST_CACHE", true);
}

export function shouldSendHeartbeatOutsideCloseWindow(): boolean {
  return readBooleanEnv("CHART_SEND_HEARTBEAT_OUTSIDE_CLOSE_WINDOW", true);
}

export function shouldSendHeartbeatOnManualRun(): boolean {
  return readBooleanEnv("CHART_SEND_HEARTBEAT_ON_MANUAL_RUN", true);
}

// ============================================================================
// Volman-specific configuration (only Volman entrypoint uses these)
// ============================================================================

export function getConfiguredChartSignalConfidenceThreshold(): number {
  const raw = process.env.CHART_SIGNAL_CONFIDENCE_THRESHOLD?.trim();
  if (!raw) return 70;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 70;
}
```

### Step 2: Create `smc-config-env.ts`

**Location:** `src/charts/smc-config-env.ts`

**Contains:** SMC-specific configuration reading

```typescript
import type { ChartEngineMode, ChartRunContext, ChartTimeframeMode } from "./chart-types-common.js";
import type { ChartTimeframe } from "./chart-types-common.js";

// ============================================================================
// Shared helpers (duplicated in both volman-config-env.ts and smc-config-env.ts)
// ============================================================================

function readBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

// ============================================================================
// Shared configuration (both Volman and SMC use these)
// ============================================================================

export function getConfiguredChartEngineMode(): ChartEngineMode {
  return "deterministic";
}

export function getConfiguredChartTimeframeMode(): ChartTimeframeMode {
  const raw = process.env.CHART_TIMEFRAME_MODE?.trim().toLowerCase();
  if (raw === "multi" || raw === "single") {
    return raw;
  }
  return "multi";
}

export function getConfiguredChartPrimaryTimeframe(): ChartTimeframe {
  const raw = process.env.CHART_PRIMARY_TIMEFRAME?.trim().toUpperCase();
  if (raw === "M15" || raw === "H4" || raw === "D1") {
    return raw as ChartTimeframe;
  }
  return "M15";
}

export function getConfiguredChartRunContext(): ChartRunContext {
  const override = process.env.CHART_RUN_CONTEXT?.trim().toLowerCase();
  if (override === "manual" || override === "auto") {
    return override as ChartRunContext;
  }

  const githubEventName = process.env.GITHUB_EVENT_NAME?.trim().toLowerCase();
  if (githubEventName === "schedule") {
    return "auto";
  }
  if (githubEventName === "workflow_dispatch") {
    return "manual";
  }

  return "manual";
}

export function getConfiguredPendingOrderExpiryRuns(): number {
  const raw = process.env.PENDING_ORDER_EXPIRY_RUNS?.trim();
  if (!raw) return 2;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 2;
}

export function shouldUseLatestCacheForManualRun(): boolean {
  return readBooleanEnv("CHART_HEARTBEAT_USE_LATEST_CACHE", true);
}

export function shouldSendHeartbeatOutsideCloseWindow(): boolean {
  return readBooleanEnv("CHART_SEND_HEARTBEAT_OUTSIDE_CLOSE_WINDOW", true);
}

export function shouldSendHeartbeatOnManualRun(): boolean {
  return readBooleanEnv("CHART_SEND_HEARTBEAT_ON_MANUAL_RUN", true);
}

// ============================================================================
// SMC-specific configuration (only SMC entrypoint uses these)
// ============================================================================

export function getConfiguredSmcSignalFreshnessCandles(): number {
  const raw = process.env.SMC_SIGNAL_FRESHNESS_CANDLES?.trim();
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 1;
}

export function getConfiguredSmcMinSignalConfidence(): number {
  const raw = process.env.SMC_MIN_SIGNAL_CONFIDENCE?.trim();
  if (!raw) return 65;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 65;
}
```

### Step 3: Keep Old File (Do NOT Delete)

**File:** `src/charts/chart-config-env.ts`  
**Status:** Keep unchanged for now

**Reason:** Some code may still import from it. Will be removed in task 10 after all imports are updated.

### Step 4: Update Entrypoint Imports

#### File: `src/charts/index.ts` (Volman)

**Change imports from:**
```typescript
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartEngineMode,
  getConfiguredChartRunContext,
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartTradingSystem,  // ← Remove this
  getConfiguredChartTimeframeMode,
} from "./chart-config-env.js";
```

**To:**
```typescript
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartEngineMode,
  getConfiguredChartRunContext,
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartTimeframeMode,
} from "./volman-config-env.js";
```

**Remove:** All references to `getConfiguredChartTradingSystem()` — replace with string literal `"bob-volman"` if needed, or remove if unused.

#### File: `src/charts/smc-index.ts` (SMC)

**Change imports from:**
```typescript
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartRunContext,
  getConfiguredChartSignalConfidenceThreshold,
  getConfiguredChartTimeframeMode,
  getConfiguredSmcMinSignalConfidence,
} from "./chart-config-env.js";
```

**To:**
```typescript
import {
  getConfiguredChartPrimaryTimeframe,
  getConfiguredChartRunContext,
  getConfiguredChartTimeframeMode,
  getConfiguredSmcMinSignalConfidence,
} from "./smc-config-env.js";
```

**Note:** If `getConfiguredChartSignalConfidenceThreshold` is used in smc-index.ts, it should be removed (SMC uses `getConfiguredSmcMinSignalConfidence` instead).

### Step 5: Remove ChartTradingSystem Type & Function

**Do NOT keep these in either new file:**
- ~~`export type ChartTradingSystem`~~ ✗ Remove
- ~~`export function getConfiguredChartTradingSystem()`~~ ✗ Remove

**Reason:** Entrypoints are now hardcoded to their respective systems. No runtime selection needed.

### Step 6: Verify Build & Tests

**Run:**
```bash
npm run build
npm run test
```

**Expected:**
- ✅ No TypeScript errors
- ✅ No import errors (all `getConfigured*` imports find correct files)
- ✅ Tests pass without changes
- ✅ No references to `getConfiguredChartTradingSystem` remain in code

**If errors:** Check that all imports in `index.ts` and `smc-index.ts` are updated correctly.

---

## Checklist

- [ ] Created `volman-config-env.ts` with Volman config
- [ ] Created `smc-config-env.ts` with SMC config
- [ ] Removed `ChartTradingSystem` type (not in either new file)
- [ ] Removed `getConfiguredChartTradingSystem()` function (not in either new file)
- [ ] Updated `index.ts` imports (Volman → volman-config-env.ts)
- [ ] Updated `smc-index.ts` imports (SMC → smc-config-env.ts)
- [ ] Removed all `getConfiguredChartTradingSystem()` calls from code
- [ ] Ran `npm run build` successfully
- [ ] Ran `npm run test` successfully
- [ ] No TypeScript errors
- [ ] No import errors
- [ ] Old `chart-config-env.ts` still exists (for task 10 cleanup)

---

## Expected Output

Create `tasks/smc-volman-full-separation/03-split-config-env/result.md` with:

1. **Files created:**
   - `src/charts/volman-config-env.ts` — line count, functions exported
   - `src/charts/smc-config-env.ts` — line count, functions exported

2. **Files updated:**
   - `src/charts/index.ts` — import changes from chart-config-env.js → volman-config-env.js
   - `src/charts/smc-index.ts` — import changes from chart-config-env.js → smc-config-env.js

3. **Code removed:**
   - `ChartTradingSystem` type (line in old file)
   - `getConfiguredChartTradingSystem()` function (line in old file)
   - All calls to `getConfiguredChartTradingSystem()` (list files where removed)

4. **Build verification:**
   - `npm run build` output (should be clean)
   - `npm run test` output (summary of passed tests)
   - List of any TypeScript errors (should be none)

5. **Verification:**
   - Confirmation that old `chart-config-env.ts` still exists
   - No remaining references to `ChartTradingSystem` in code
   - No remaining references to `getConfiguredChartTradingSystem()` in code

---

## Important Notes

⚠️ **Do NOT delete old `chart-config-env.ts`** — keep for task 10 cleanup

✅ **Both new files contain shared functions** — OK to duplicate (future: extract to common file if needed)

✅ **Entrypoints are now hardcoded to their systems** — no runtime selection needed

✅ **SMC uses different confidence function** — `getConfiguredSmcMinSignalConfidence()` not `getConfiguredChartSignalConfidenceThreshold()`

---

## No Database Changes This Step

This is pure TypeScript configuration reorganization. No database changes.
