# Task 02 — Shared Data Layer & Type Splitting

**Subtask ID:** `02-shared-data-layer-and-types`  
**Date:** 2026-07-10  
**Worker:** Haiku  
**Dependencies:** Task 01 (DB split) must be merged first

---

## Objective

Establish clear separation between:
1. **Shared data provider layer** (OHLC, infrastructure) — no changes
2. **Domain-specific types** (Volman vs SMC) — split into 3 files
3. **Documentation** — fix stale references (MetaApi → TwelveData)

---

## Background

Current `src/charts/chart-types.ts` mixes:
- **Common types** (infrastructure-level): `CandleRangeStats`, `ChartTimeframe`, `ChartOrderType`, `ChartConfig`, `ChartAnalysisSource`, `ScreenshotResult`, `Candle` (in ohlc-provider)
- **Volman-specific types** (business logic): `TradeSetup` with `emaTouch`, `entryCondition`, `currentPriceContext`
- **SMC-specific types** (business logic): Same `TradeSetup` with `grade`, `score`, `market`, `session`, `entryZone`, `liquidityTargets`, `caution`, `capitalManagement`

**Problem:** Both systems use the same TradeSetup type with optional fields → unclear which fields belong where → hard to evolve each system independently.

**Solution:** Split types by domain:
- `chart-types-common.ts` — infrastructure types (used by both systems)
- `chart-types-volman.ts` — Volman-specific `TradeSetup`, `AnalysisResult`, `PairSummary`
- `chart-types-smc.ts` — SMC-specific `TradeSetup`, `AnalysisResult`, `PairSummary`

OHLC provider (`ohlc-provider.ts`, `ohlc-cache-repository.ts`) stays shared and unchanged.

---

## Task Steps

### Step 1: Create `chart-types-common.ts`

**Location:** `src/charts/chart-types-common.ts`

**Contains:** Infrastructure types used by both Volman and SMC (NO changes to these types)

```typescript
export type CandleRangeStats = {
  high: number;
  low: number;
  lastClose: number | null;
};

export type ChartTimeframe = "M15" | "M30" | "H1" | "H4" | "D1";

export type ChartOrderType =
  | "MARKET_NOW"
  | "BUY_STOP"
  | "SELL_STOP"
  | "BUY_LIMIT"
  | "SELL_LIMIT"
  | "WAIT_FOR_CONFIRMATION";

export type ChartConfig = {
  name: string;
  symbol: string;
  interval: string;
  description: string;
  timeframe: ChartTimeframe;
};

export type ChartAnalysisSource = {
  symbol: string;
  timeframe: ChartTimeframe;
  name: string;
  filepath: string;
  lastPrice?: number | null;
};

export type ScreenshotResult = {
  chart: ChartConfig;
  buffer: Buffer;
  filepath: string;
  lastPrice: number | null;
};

export type PendingOrderStatus = "PENDING" | "TRIGGERED" | "EXPIRED" | "CANCELLED";

export type PendingOrder = {
  id: number;
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string | null;
  orderType: ChartOrderType;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string | null;
  confidence: number | null;
  reasons: string[] | null;
  risks: string[] | null;
  primaryTimeframe: ChartTimeframe | null;
  sourceChartFilepath: string | null;
  status: PendingOrderStatus;
  runCount: number;
  expiryRuns: number;
  createdAt: string;
  resolvedAt: string | null;
  resolvedReason: string | null;
  triggeredPositionId: number | null;
};
```

### Step 2: Create `chart-types-volman.ts`

**Location:** `src/charts/chart-types-volman.ts`

**Contains:** Volman-specific types (import common types from `chart-types-common.ts`)

```typescript
import type {
  ChartTimeframe,
  ChartOrderType,
  ChartAnalysisSource,
  ScreenshotResult,
} from "./chart-types-common.js";

export type TradeSetup = {
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string;
  primaryTimeframe?: ChartTimeframe;
  emaTouch?: boolean;  // Volman-specific
  reasons: string[];
  risks: string[];
  confidence: number;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskReward: string;
  summary: string;
  orderType?: ChartOrderType;
  entryCondition?: string;  // Volman-specific
  currentPriceContext?: string;  // Volman-specific
  autoTracked?: boolean;
  chartFallbackUsed?: boolean;
  ruleTrace?: string[];
  detectionSource?: "deterministic" | "ai";
  sourceCharts?: ChartAnalysisSource[];
  telegramChart?: ChartAnalysisSource;
  lastPrice?: number | null;
};

export type PairSummary = {
  pair: string;
  trend: string;
  emaProximity?: "tại" | "gần" | "xa";
  status: string;
  confidence: number;
  ruleTrace?: string[];
  detectionSource?: "deterministic" | "ai";
};

export type AnalysisStats = {
  attemptedPairs: number;
  okPairs: number;
  noSetupPairs: number;
  skippedPairs: number;
  setupCount: number;
};

export type AnalysisResult = {
  summaries: PairSummary[];
  setups: TradeSetup[];
  noSetupReason: string;
  screenshots: ScreenshotResult[];
  analysisStats?: AnalysisStats;
};
```

### Step 3: Create `chart-types-smc.ts`

**Location:** `src/charts/chart-types-smc.ts`

**Contains:** SMC-specific types (import common types from `chart-types-common.ts`)

```typescript
import type {
  ChartTimeframe,
  ChartOrderType,
  ChartAnalysisSource,
  ScreenshotResult,
} from "./chart-types-common.js";

export type TradeSetup = {
  pair: string;
  direction: "LONG" | "SHORT";
  setup: string;
  primaryTimeframe?: ChartTimeframe;
  reasons: string[];
  risks: string[];
  confidence: number;
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  riskReward: string;
  summary: string;
  orderType?: ChartOrderType;
  detectionSource?: "smc";
  sourceCharts?: ChartAnalysisSource[];
  telegramChart?: ChartAnalysisSource;
  lastPrice?: number | null;
  // SMC-specific fields
  grade?: "A" | "B" | "C" | "D";
  score?: number;
  market?: string;
  session?: string;
  sessionLabel?: string;
  entryZone?: { low: string; high: string };
  stopLossDistance?: string;
  takeProfit3?: string;
  takeProfitAllocations?: { tp1: number; tp2: number; tp3: number };
  liquidityTargets?: Array<{
    label: string;
    price: string;
    target: "TP1" | "TP2" | "TP3";
    riskReward?: string;
  }>;
  caution?: string;
  capitalManagement?: string[];
};

export type PairSummary = {
  pair: string;
  trend: string;
  status: string;
  confidence: number;
  ruleTrace?: string[];
  detectionSource?: "smc";
};

export type AnalysisStats = {
  attemptedPairs: number;
  okPairs: number;
  noSetupPairs: number;
  skippedPairs: number;
  setupCount: number;
};

export type AnalysisResult = {
  summaries: PairSummary[];
  setups: TradeSetup[];
  noSetupReason: string;
  screenshots: ScreenshotResult[];
  analysisStats?: AnalysisStats;
};
```

### Step 4: Rename & Archive Old File

**Action:** Keep old `chart-types.ts` as reference (do NOT delete yet — used by existing code)

**Status:** Will be removed in subtask 10 after all code is updated

### Step 5: Verify OHLC Provider & Cache Remain Unchanged

**Files to verify:** `src/charts/ohlc-provider.ts`, `src/charts/ohlc-cache-repository.ts`

**Expected:** NO changes needed — these files stay shared and untouched

**Verification:** Run `npm run build` to ensure no import errors

---

## Step 6: Update Documentation

**File:** `docs/volman-numeric-engine.md`

**Current line 26:**
```
OHLC Provider (MetaApi, H4)            src/charts/ohlc-provider.ts
```

**Change to:**
```
OHLC Provider (TwelveData, H4)          src/charts/ohlc-provider.ts
```

**Reason:** MetaApi is not actually used in current codebase. Only TwelveData is active. (Verified: grep found 0 active MetaApi imports in src/, only in .env.example and 1 test + this doc.)

**Additional check:** Search entire doc for any other MetaApi references and update similarly.

---

## Step 6b (bổ sung sau Lead self-review 2026-07-10): Split `analyzer.ts`

**Phát hiện:** `src/charts/analyzer.ts` cũng bị dùng chung nhưng KHÔNG thuần hạ tầng — nó import `TradeSetup`, `PairSummary`, `PendingOrder` từ `chart-types.js` (gốc). Grep xác nhận:
- `buildChartAnalysisCacheKey` (không phụ thuộc `TradeSetup`, chỉ nhận string) được dùng bởi CẢ `index.ts` VÀ `smc-index.ts` → an toàn giữ chung, thuần kỹ thuật.
- `applyPriceSanityChecks`, `formatPrice` (phụ thuộc `TradeSetup`) chỉ được `src/charts/signal-assembly.ts` (Volman-only, KHÔNG phải SMC) import — `src/charts/smc/smc-signal-assembly.ts` không import `analyzer.ts` (có logic riêng).
- `parseAnalysisResponse`, `buildPendingOrderCheckPrompt`, `parsePendingOrderCheckResponse`, `cleanResponse`, `extractJsonObject`, `clampConfidence` — thuộc luồng AI-vision cũ (engine mode hiện luôn `"deterministic"`, xem `getConfiguredChartEngineMode`), grep xem có ai còn gọi thật không trước khi quyết định giữ hay bỏ; nếu không ai gọi, vẫn copy sang bản mới cho an toàn (không xoá logic, tránh phá vỡ hành vi ẩn), không cần lo tối ưu.

**Việc cần làm:**
1. Tạo `src/charts/analyzer-common.ts`: chứa `buildChartAnalysisCacheKey`, `cleanResponse`, `extractJsonObject`, `clampConfidence` (các hàm thuần string/number, không phụ thuộc `TradeSetup`/`PairSummary`/`PendingOrder`).
2. Tạo `src/charts/analyzer-volman.ts`: chứa `applyPriceSanityChecks`, `formatPrice`, `parseAnalysisResponse`, `buildPendingOrderCheckPrompt`, `parsePendingOrderCheckResponse`, và các helper private liên quan (`normalizePairKey`, `parsePrice`, `toText`, `toArray`, `normalizeOrderType`, `normalizeDirection`, `normalizeTimeframe`, `normalizePendingStatus`) — import `TradeSetup`, `PairSummary`, `PendingOrder`, `ChartOrderType` từ `./chart-types-volman.js` thay vì `./chart-types.js`.
3. KHÔNG sửa `src/charts/signal-assembly.ts` để đổi import trong task này (giữ nguyên `import { formatPrice, applyPriceSanityChecks } from "./analyzer.js";` — việc rewire import ở `signal-assembly.ts` sang `./analyzer-volman.js` là việc của task 10, cùng lúc rewire `index.ts`/`smc-index.ts`).
4. KHÔNG xoá `analyzer.ts` gốc (giữ tới task 10).
5. Viết test tối thiểu cho `analyzer-common.ts` và `analyzer-volman.ts` dưới `tests/charts/` (copy pattern từ `tests/charts/analyzer.test.ts` nếu tồn tại).

## Step 7: Verify Build Success

**Run:**
```bash
npm run build
npm run test
```

**Expected:**
- ✅ No TypeScript errors (all types compile)
- ✅ No import/export errors
- ✅ Test suite passes (or existing tests don't break)

**Note:** Tests may reference old `chart-types.ts` still. Update imports in tests to use appropriate new files:
- Tests for Volman logic → import from `chart-types-volman.ts`
- Tests for SMC logic → import from `chart-types-smc.ts`
- Tests using common types → import from `chart-types-common.ts`

---

## Checklist

- [ ] Created `chart-types-common.ts` with infrastructure types
- [ ] Created `chart-types-volman.ts` with Volman-specific types
- [ ] Created `chart-types-smc.ts` with SMC-specific types
- [ ] Verified `ohlc-provider.ts` unchanged
- [ ] Verified `ohlc-cache-repository.ts` unchanged
- [ ] Updated `docs/volman-numeric-engine.md` (MetaApi → TwelveData)
- [ ] Ran `npm run build` successfully
- [ ] Ran `npm run test` successfully
- [ ] No TypeScript errors
- [ ] Updated test imports as needed
- [ ] Old `chart-types.ts` still exists (marked for deletion in task 10)
- [ ] All imports between files use `.js` extension (ESM)

---

## Expected Output

Create `tasks/smc-volman-full-separation/02-shared-data-layer-and-types/result.md` with:

1. **Files created:**
   - `src/charts/chart-types-common.ts` — line count, types exported
   - `src/charts/chart-types-volman.ts` — line count, types exported
   - `src/charts/chart-types-smc.ts` — line count, types exported

2. **Files verified unchanged:**
   - `src/charts/ohlc-provider.ts` — confirmed no changes
   - `src/charts/ohlc-cache-repository.ts` — confirmed no changes

3. **Documentation updated:**
   - `docs/volman-numeric-engine.md` — location of change (line 26), before/after text

4. **Build verification:**
   - `npm run build` output (should be clean)
   - `npm run test` output (summary of passed/failed tests)
   - List of any TypeScript errors (should be none)

5. **Test updates:**
   - List of test files updated with new imports
   - Summary of test fixes applied

6. **Remaining cleanup:**
   - Confirmation that old `chart-types.ts` still exists
   - Note that it will be removed in task 10

---

## Important Notes

⚠️ **Do NOT delete old `chart-types.ts` yet** — subtasks 03-09 will gradually migrate imports. Final deletion happens in task 10.

✅ **All new files use `.js` ESM import paths** (e.g., `from "./chart-types-common.js"`)

✅ **No functional changes** — this is purely type organization. Existing code behavior unchanged.

✅ **OHLC Provider stays shared** — this is the decision from plan.md. Both Volman and SMC will continue importing from `ohlc-provider.ts`.

---

## No Database Changes This Step

This is pure TypeScript type splitting. Database migration from task 01 is already applied separately.
