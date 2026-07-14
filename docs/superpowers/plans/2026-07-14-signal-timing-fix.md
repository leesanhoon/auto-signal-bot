# Signal Timing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Telegram signals from being sent after price has already run away from the entry, and add a 1R breakeven reminder for open positions, while keeping Binance live order execution disabled.

**Architecture:** Five independent, sequential changes layered on the existing Volman deterministic pipeline: (1) a distance-from-entry gate added to the existing freshness guard, (2) a one-line lookback reduction in the detection loop, (3) a live-price marker added to the existing SVG chart renderer, (4)+(5) a new "reached 1R" decision branch in the open-position management pipeline that notifies Telegram and moves the tracked stop-loss to breakeven without closing the position. No new services, no new detector logic, no schema migration (breakeven state is inferred from `stopLoss === entry`, not a new column).

**Tech Stack:** TypeScript, Vitest, Supabase (existing `open_positions_volman` table, no migration needed), Playwright-rendered SVG charts.

## Global Constraints

- `TP_R_MULTIPLE` stays 2R — do not touch take-profit calculation.
- Entry-distance gate default threshold: 50 (`SIGNAL_MAX_ENTRY_DISTANCE_PCT` env var, percent).
- Detection lookback is reduced to the single most recently closed candle — no partial rollback to a wider window.
- ARB, RB, and IRB detector logic (`src/charts/setups/arb.ts`, `rb.ts`, `irb.ts`) must NOT be modified — pre-breakout alerting was investigated and explicitly rejected for these three (see spec, section 4). Do not touch their breakout-confirmation gates.
- No Binance order-placement code (`binance-futures-client.ts`, `binance-execution-shared.ts`) may be modified — disabling live trading is a config/env concern only.
- No new database columns/migrations — breakeven-applied state is inferred by comparing `entry` and `stopLoss`, both already-existing fields.
- Test command for every task: `npx vitest run <file>` (repo-wide: `npm test`, defined in `package.json` as `vitest run`).
- Follow existing code style: Vietnamese (no-accent, ASCII) log/trace strings match the surrounding file's convention; user-facing Telegram text uses Vietnamese with accents, matching `telegram-volman.ts`.

---

### Task 1: Entry-distance gate in the signal freshness guard

**Files:**
- Modify: `src/charts/volman-config-env.ts`
- Modify: `src/charts/signal-freshness.ts`
- Test: `tests/charts/volman-config-env.test.ts` (create if it does not exist — check first)
- Test: `tests/charts/signal-freshness.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `getConfiguredSignalMaxEntryDistancePercent(): number` (in `volman-config-env.ts`), `isEntryTooFarFromMarket(direction: "LONG" | "SHORT", lastPrice: number, entry: number, takeProfit1: number, maxDistancePercent: number): boolean` (in `signal-freshness.ts`, exported for direct unit testing). No other task depends on these.

- [ ] **Step 1: Check whether a config env test file already exists**

Run: `ls tests/charts/volman-config-env.test.ts 2>/dev/null || echo "not found"`

If "not found", the new test in Step 2 creates the file. If it exists, read it first and append the new `describe` block in the same style (do not overwrite existing tests).

- [ ] **Step 2: Write the failing test for the new config getter**

Add to `tests/charts/volman-config-env.test.ts` (create with this content if the file does not exist; otherwise append the `describe` block):

```typescript
import { describe, expect, test, beforeEach } from "vitest";
import { getConfiguredSignalMaxEntryDistancePercent } from "../../src/charts/volman-config-env.js";

describe("getConfiguredSignalMaxEntryDistancePercent", () => {
  beforeEach(() => {
    delete process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT;
  });

  test("defaults to 50 when unset", () => {
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });

  test("reads a valid override from env", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "30";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(30);
  });

  test("falls back to 50 for a non-numeric value", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "abc";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });

  test("falls back to 50 for an out-of-range value (>100)", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "150";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });

  test("falls back to 50 for zero or negative values", () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "0";
    expect(getConfiguredSignalMaxEntryDistancePercent()).toBe(50);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/charts/volman-config-env.test.ts`
Expected: FAIL — `getConfiguredSignalMaxEntryDistancePercent is not a function` (or module has no such export).

- [ ] **Step 4: Implement the config getter**

In `src/charts/volman-config-env.ts`, add after `getConfiguredTpRMultiple` (after line 100, before the `EMA Exit configuration` section comment):

```typescript
// Nguong % quang duong tu entry den TP1 ma gia da chay qua truoc khi tu choi
// gui tin hieu (chong "duoi gia" — xem docs/superpowers/specs/2026-07-14-signal-timing-fix-design.md).
export function getConfiguredSignalMaxEntryDistancePercent(): number {
  const raw = process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT?.trim();
  if (!raw) return 50;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : 50;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/charts/volman-config-env.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/charts/volman-config-env.ts tests/charts/volman-config-env.test.ts
git commit -m "feat: add SIGNAL_MAX_ENTRY_DISTANCE_PCT config getter"
```

- [ ] **Step 7: Write the failing test for the entry-distance gate**

Add to `tests/charts/signal-freshness.test.ts`, inside the existing `describe("applySignalFreshnessGuard", ...)` block (after the last existing `test(...)`, before the closing `});` at line 265):

```typescript
  test("LONG setup: skipped when price has run >=50% of the way to TP1 (default threshold)", async () => {
    // entry=1.1000, TP1=1.1100 -> total distance 0.0100. 50% = 1.1050.
    mockFetchLastPrice.mockResolvedValue(1.1051);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("chay qua xa entry");
  });

  test("LONG setup: NOT skipped when price has run <50% of the way to TP1", async () => {
    mockFetchLastPrice.mockResolvedValue(1.1049);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
  });

  test("SHORT setup: skipped when price has run >=50% of the way to TP1 (default threshold)", async () => {
    // entry=1.1000, TP1=1.0900 -> total distance 0.0100. 50% = 1.0950.
    mockFetchLastPrice.mockResolvedValue(1.0949);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    expect(result.noSetupReason).toContain("chay qua xa entry");
  });

  test("SHORT setup: NOT skipped when price has run <50% of the way to TP1", async () => {
    mockFetchLastPrice.mockResolvedValue(1.0951);

    const result = await applySignalFreshnessGuard(mockSetupShort, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
  });

  test("respects SIGNAL_MAX_ENTRY_DISTANCE_PCT override", async () => {
    process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT = "30";
    // entry=1.1000, TP1=1.1100 -> total distance 0.0100. 30% = 1.1030.
    mockFetchLastPrice.mockResolvedValue(1.1031);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeDefined();
    delete process.env.SIGNAL_MAX_ENTRY_DISTANCE_PCT;
  });

  test("price moving against the setup direction does not trigger the distance gate", async () => {
    // LONG setup, price dipped slightly below entry but still above SL — 0% progress toward TP1.
    mockFetchLastPrice.mockResolvedValue(1.0990);

    const result = await applySignalFreshnessGuard(mockSetupLong, "OANDA:EURUSD");

    expect(result.noSetupReason).toBeUndefined();
  });
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run tests/charts/signal-freshness.test.ts`
Expected: FAIL — the new "skipped when price has run >=50%..." tests fail because `result.noSetupReason` is `undefined` (gate not implemented yet).

- [ ] **Step 9: Implement the entry-distance gate**

In `src/charts/signal-freshness.ts`, add the import and the new function, then call it from `applySignalFreshnessGuard`.

Add to the imports at the top (after line 3):

```typescript
import { getConfiguredSignalMaxEntryDistancePercent } from "./volman-config-env.js";
```

Replace the end of `applySignalFreshnessGuard` (lines 60-74, from `const isStale = ...` through the closing `}`):

```typescript
  const isStale = isSetupStale(setup.direction, lastPrice, stopLoss, takeProfit1);

  if (isStale) {
    const reason =
      `Gia da vuot TP1/SL (check gia tuc: ${formatPrice(lastPrice)}). ` +
      `Entry: ${formatPrice(entry)}, TP1: ${formatPrice(takeProfit1)}, SL: ${formatPrice(stopLoss)}.`;

    return {
      ...setup,
      noSetupReason: reason,
    };
  }

  const maxDistancePercent = getConfiguredSignalMaxEntryDistancePercent();
  if (isEntryTooFarFromMarket(setup.direction, lastPrice, entry, takeProfit1, maxDistancePercent)) {
    const reason =
      `Gia da chay qua xa entry truoc khi gui tin hieu (da di >= ${maxDistancePercent}% quang duong toi TP1, ` +
      `gia hien tai: ${formatPrice(lastPrice)}). Entry: ${formatPrice(entry)}, TP1: ${formatPrice(takeProfit1)}.`;

    return {
      ...setup,
      noSetupReason: reason,
    };
  }

  return setup as SetupWithFreshness;
}

/**
 * True when price has already traveled at least `maxDistancePercent` of the
 * distance from entry to TP1, in the setup's own direction. Used to skip
 * sending a signal that would show an entry the market has already left far
 * behind (see docs/superpowers/specs/2026-07-14-signal-timing-fix-design.md).
 */
export function isEntryTooFarFromMarket(
  direction: "LONG" | "SHORT",
  lastPrice: number,
  entry: number,
  takeProfit1: number,
  maxDistancePercent: number,
): boolean {
  const totalDistance = Math.abs(takeProfit1 - entry);
  if (totalDistance <= 0) return false;

  const traveled = direction === "LONG" ? lastPrice - entry : entry - lastPrice;
  if (traveled <= 0) return false;

  const progressPercent = (traveled / totalDistance) * 100;
  return progressPercent >= maxDistancePercent;
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run tests/charts/signal-freshness.test.ts`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 11: Run the freshness integration test to check for regressions**

Run: `npx vitest run tests/charts/signal-freshness-integration.test.ts`
Expected: PASS — the existing scenarios use prices already past TP1/SL, which the earlier `isStale` check catches first, so the new gate does not change their outcome.

- [ ] **Step 12: Commit**

```bash
git add src/charts/signal-freshness.ts tests/charts/signal-freshness.test.ts
git commit -m "feat: skip signals whose price has already run past the entry-distance gate"
```

---

### Task 2: Reduce detection lookback to the single most recently closed candle

**Files:**
- Modify: `src/charts/deterministic-pipeline.ts:42,103`
- Test: `tests/charts/deterministic-pipeline.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks depend on (behavioral change only).

- [ ] **Step 1: Write the failing test**

Add to `tests/charts/deterministic-pipeline.test.ts`, inside `describe("deterministic pipeline", ...)`, after the existing `test("anchors detectors on the last closed candle returned by fetchOhlcHistory", ...)` block (after line 135):

```typescript
  test("only scans the single most recently closed candle (lookback = 1)", async () => {
    const candles: Candle[] = Array.from({ length: 31 }, (_, i) => ({
      time: (i + 1) * 1000,
      open: 1 + i * 0.001,
      high: 1.1 + i * 0.001,
      low: 0.9 + i * 0.001,
      close: 1.05 + i * 0.001,
      volume: 10 + i,
    }));
    mocks.fetchOhlcHistory.mockResolvedValue(candles);
    mocks.calculateEma.mockReturnValue(candles.map(() => 1));
    mocks.calculateAtr.mockReturnValue(candles.map(() => 0.5));

    const scannedIndices: number[] = [];
    const recordIndex = vi.fn((_candles: Candle[], i: number) => {
      scannedIndices.push(i);
      return null;
    });
    mocks.detectDd.mockImplementation(recordIndex);
    mocks.detectFb.mockImplementation(recordIndex);
    mocks.detectBb.mockImplementation(recordIndex);
    mocks.detectRb.mockImplementation(recordIndex);
    mocks.detectArb.mockImplementation(recordIndex);
    mocks.detectIrb.mockImplementation(recordIndex);

    await analyzeAllChartsDeterministic([{ pair: "EUR/USD", symbol: "OANDA:EURUSD" }], {
      timeframeMode: "single",
      primaryTimeframe: "H4",
    });

    // lastIndex is 30 (31 candles, 0-based). Only index 30 should ever be scanned.
    expect(new Set(scannedIndices)).toEqual(new Set([30]));
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/charts/deterministic-pipeline.test.ts`
Expected: FAIL — `scannedIndices` contains `[25, 26, 27, 28, 29, 30]` (repeated per detector), not just `[30]`.

- [ ] **Step 3: Implement the lookback reduction**

In `src/charts/deterministic-pipeline.ts`, change line 103:

```typescript
      const startDetectIndex = Math.max(30, lastIndex - 5);
```

to:

```typescript
      const startDetectIndex = lastIndex;
```

And update the docstring comment at line 42 from:

```typescript
 * 4. Run all 7 Volman setup detectors (DDB, FB, SB, BB, RB, ARB, IRB) on the runtime primary timeframe
```

to:

```typescript
 * 4. Run all 7 Volman setup detectors (DDB, FB, SB, BB, RB, ARB, IRB) on the single most
 *    recently closed candle only (no retroactive lookback — a missed run drops that
 *    candle's trigger rather than reporting it late)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/charts/deterministic-pipeline.test.ts`
Expected: PASS (3 tests: the two pre-existing plus the new one).

- [ ] **Step 5: Commit**

```bash
git add src/charts/deterministic-pipeline.ts tests/charts/deterministic-pipeline.test.ts
git commit -m "fix: reduce detection lookback to the single most recently closed candle"
```

---

### Task 3: Render a live-price marker on the setup chart

**Files:**
- Modify: `src/charts/signal-assembly.ts:189`
- Modify: `src/charts/setup-chart-renderer.ts`
- Modify: `src/shared/telegram-volman.ts:461-469`
- Test: `tests/charts/setup-chart-renderer.test.ts`

**Interfaces:**
- Consumes: `TradeSetup.lastPrice` (already exists on the type, `chart-types-volman.ts:47`).
- Produces: `SetupChartInput.livePrice?: number | null` — no other task depends on this.

- [ ] **Step 1: Write the failing test for the chart window extension**

First check the existing signal-assembly test file for the current slicing assertion:

Run: `grep -n "sliceEndIndex\|CHART_CONTEXT_WINDOW\|triggerIndex + 2" tests/charts/*.test.ts`

If a test asserts the old `triggerIndex + 2` cutoff, note its file/line — it will need updating in Step 3 below. If no such test exists, skip straight to Step 2.

- [ ] **Step 2: Write the failing test for the live-price line in the chart renderer**

Add to `tests/charts/setup-chart-renderer.test.ts` (open the file first to match its existing `describe`/import style, then add):

```typescript
  test("draws a distinctly-colored live price line when livePrice is provided", () => {
    const svg = buildSetupChartSvg({
      pair: "EUR/USD",
      setup: "RB",
      direction: "LONG",
      entry: 1.1,
      stopLoss: 1.09,
      takeProfit: 1.12,
      livePrice: 1.115,
      chartContext: {
        candles: [
          { time: 1, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: 10 },
          { time: 2, open: 1.105, high: 1.116, low: 1.1, close: 1.115, volume: 12 },
        ],
        ma21: [1.1, 1.11],
        triggerIndex: 0,
        sliceStartIndex: 0,
      },
    });

    expect(svg).toContain("Giá hiện tại");
    // Live price line must use a color distinct from entry (#FFFF00), SL (#FF0000), TP (#00AA00).
    expect(svg).not.toContain('stroke="#FFFF00" stroke-width="1" stroke-dasharray="5,5"');
  });

  test("omits the live price line when livePrice is not provided", () => {
    const svg = buildSetupChartSvg({
      pair: "EUR/USD",
      setup: "RB",
      direction: "LONG",
      entry: 1.1,
      stopLoss: 1.09,
      takeProfit: 1.12,
      chartContext: {
        candles: [{ time: 1, open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: 10 }],
        ma21: [1.1],
        triggerIndex: 0,
        sliceStartIndex: 0,
      },
    });

    expect(svg).not.toContain("Giá hiện tại");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/charts/setup-chart-renderer.test.ts`
Expected: FAIL — TypeScript error or runtime failure, since `livePrice` is not a recognized field on `SetupChartInput` and no "Giá hiện tại" text is emitted.

- [ ] **Step 4: Extend the candle window in signal-assembly.ts**

In `src/charts/signal-assembly.ts`, change line 189 from:

```typescript
    const sliceEndIndex = Math.min(ohlcContext.candles.length, triggerIndex + 2);
```

to:

```typescript
    const sliceEndIndex = ohlcContext.candles.length;
```

- [ ] **Step 5: Add `livePrice` to `SetupChartInput` and draw the line**

In `src/charts/setup-chart-renderer.ts`:

Change the type at lines 22-30:

```typescript
export type SetupChartInput = {
  pair: string;
  setup: string;
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  livePrice?: number | null;
  chartContext: ChartContext;
};
```

Update `buildCoordMap` (lines 45-78) to also account for `livePrice` in the min/max price range, so the line never renders off-chart:

```typescript
function buildCoordMap(
  candles: Candle[],
  stopLoss: number,
  takeProfit: number,
  livePrice: number | null,
): CoordMap {
  const marginLeft = 40;
  const marginRight = 40;
  const marginTop = 40;
  const marginBottom = 40;
  const chartWidth = 900 - marginLeft - marginRight;
  const chartHeight = 500 - marginTop - marginBottom;

  const priceInputs = [
    ...candles.map((c) => c.low),
    ...candles.map((c) => c.high),
    stopLoss,
    takeProfit,
    ...(livePrice !== null && Number.isFinite(livePrice) ? [livePrice] : []),
  ];
  let minPrice = Math.min(...priceInputs);
  let maxPrice = Math.max(...priceInputs);

  // Add 5% padding
  const padding = (maxPrice - minPrice) * 0.05;
  minPrice -= padding;
  maxPrice += padding;

  return {
    minX: 0,
    maxX: candles.length - 1,
    minY: minPrice,
    maxY: maxPrice,
    chartWidth,
    chartHeight,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
  };
}
```

Update the call site in `buildSetupChartSvg` (line 97) from:

```typescript
  const { pair, setup, direction, entry, stopLoss, takeProfit, chartContext } = input;
  const { candles, ma21, sliceStartIndex, geometry } = chartContext;

  const coord = buildCoordMap(candles, stopLoss, takeProfit);
```

to:

```typescript
  const { pair, setup, direction, entry, stopLoss, takeProfit, livePrice, chartContext } = input;
  const { candles, ma21, sliceStartIndex, geometry } = chartContext;

  const coord = buildCoordMap(candles, stopLoss, takeProfit, livePrice ?? null);
```

Add the live-price line right after the existing entry/SL/TP lines block (after line 230, before `// Draw the setup label near its breakout/signal point` at line 232):

```typescript
  // Draw live price line — distinct color/style from entry/SL/TP so the gap
  // between the (possibly stale) entry and current price is visually obvious.
  if (livePrice !== null && livePrice !== undefined && Number.isFinite(livePrice)) {
    const y = mapYCoord(livePrice, coord);
    const x1 = coord.marginLeft;
    const x2 = 900 - coord.marginRight;

    svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#00CFFF" stroke-width="1.5" opacity="0.9"/>`;
    svg += `<text x="${x1 + 5}" y="${y - 6}" font-size="10" fill="#00CFFF">Giá hiện tại ${livePrice.toFixed(5)}</text>`;
  }
```

- [ ] **Step 6: Wire `livePrice` through the Telegram chart-input builder**

In `src/shared/telegram-volman.ts`, in the `chartInputs.push(...)` block (lines 459-470), add `livePrice`:

```typescript
    chartInputs.push({
      setup,
      input: {
        pair: setup.pair,
        setup: setup.setup,
        direction: setup.direction,
        entry,
        stopLoss,
        takeProfit,
        livePrice: setup.lastPrice ?? null,
        chartContext: setup.chartContext,
      },
    });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/charts/setup-chart-renderer.test.ts`
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 8: Run the full charts + shared test suites to check for regressions**

Run: `npx vitest run tests/charts tests/shared`
Expected: PASS — no other test asserts the old `triggerIndex + 2` cutoff or the old 4-argument-free `buildCoordMap` (internal, not exported, so no external test can reference it directly).

- [ ] **Step 9: Commit**

```bash
git add src/charts/signal-assembly.ts src/charts/setup-chart-renderer.ts src/shared/telegram-volman.ts tests/charts/setup-chart-renderer.test.ts
git commit -m "feat: render live price on setup charts and extend candle window through latest candle"
```

---

### Task 4: 1R breakeven decision logic

**Files:**
- Modify: `src/charts/position-engine-volman.ts:6,193-208`
- Modify: `src/charts/position-decision-volman.ts`
- Test: `tests/charts/position-engine.test.ts`
- Test: `tests/charts/position-decision.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `PositionDecisionAction` now includes `"BREAKEVEN_NOTIFY"`; `resolveOpenPositionDecision(...)` can return `{ decision: "HOLD", managementAction: "BREAKEVEN_NOTIFY", ... }`; `deriveManagementPatch(...)` returns `{ patch: { lastManagementAction: "BREAKEVEN_NOTIFY", lastManagementComment, lastManagementAt }, closePosition: false }` for that decision. Task 5 consumes both of these exact shapes.

- [ ] **Step 1: Write the failing test for `deriveManagementPatch`**

Add to `tests/charts/position-engine.test.ts`, inside `describe("charts/position-engine", ...)`:

```typescript
  test("derives a non-closing patch for a breakeven notify decision", () => {
    const decision = {
      decision: "HOLD" as const,
      confidence: 90,
      comment: "Đã đạt 1R — dời SL về entry 1.1000.",
      managementAction: "BREAKEVEN_NOTIFY" as const,
    };

    const { patch, closePosition } = deriveManagementPatch(decision);

    expect(closePosition).toBe(false);
    expect(patch).toMatchObject({
      lastManagementAction: "BREAKEVEN_NOTIFY",
      lastManagementComment: decision.comment,
    });
    expect(patch?.tradeStage).toBeUndefined();
  });

  test("a plain HOLD with managementAction NONE still produces no patch", () => {
    const { patch, closePosition } = deriveManagementPatch({
      decision: "HOLD",
      confidence: 50,
      comment: "no change",
      managementAction: "NONE",
    });

    expect(patch).toBeNull();
    expect(closePosition).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/charts/position-engine.test.ts`
Expected: FAIL — TypeScript error (`"BREAKEVEN_NOTIFY"` is not assignable to `PositionDecisionAction`) or `patch` is `null` instead of the expected object.

- [ ] **Step 3: Add `BREAKEVEN_NOTIFY` to `PositionDecisionAction` and update `deriveManagementPatch`**

In `src/charts/position-engine-volman.ts`, change line 6:

```typescript
export type PositionDecisionAction = "NONE" | "TAKE_PROFIT_CLOSE";
```

to:

```typescript
export type PositionDecisionAction = "NONE" | "TAKE_PROFIT_CLOSE" | "BREAKEVEN_NOTIFY";
```

Replace `deriveManagementPatch` (lines 193-208):

```typescript
export function deriveManagementPatch(
  decision: PositionDecisionOutcome,
): { patch: OpenPositionManagementPatch | null; closePosition: boolean } {
  const now = new Date().toISOString();

  if (decision.managementAction === "BREAKEVEN_NOTIFY") {
    return {
      patch: {
        lastManagementAction: decision.managementAction,
        lastManagementComment: decision.comment,
        lastManagementAt: now,
      },
      closePosition: false,
    };
  }

  if (decision.decision === "HOLD") return { patch: null, closePosition: false };

  return {
    patch: {
      tradeStage: "closed",
      lastManagementAction: decision.managementAction,
      lastManagementComment: decision.comment,
      lastManagementAt: now,
    },
    closePosition: true,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/charts/position-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/charts/position-engine-volman.ts tests/charts/position-engine.test.ts
git commit -m "feat: add BREAKEVEN_NOTIFY management action"
```

- [ ] **Step 6: Write the failing tests for the 1R check in `resolveOpenPositionDecision`**

Add to `tests/charts/position-decision.test.ts`, inside `describe("charts/position-decision", ...)`. The existing `position` fixture at the top of the file is `{ direction: "LONG", entry: "1.1000", stopLoss: "1.0960", takeProfit1: "1.1080" }` — R = 0.0040, so 1R = 1.1040 (note this already matches the 2R take-profit: entry + 2R = 1.1080).

```typescript
  test("reaching 1R (below TP, above SL) triggers a breakeven notify, not a close", () => {
    const result = resolveOpenPositionDecision(position, {
      high: 1.104,
      low: 1.099,
      lastClose: 1.1035,
    });

    expect(result).toMatchObject({
      decision: "HOLD",
      managementAction: "BREAKEVEN_NOTIFY",
    });
    expect(result.comment).toContain("1R");
  });

  test("does not re-trigger breakeven notify once stopLoss already equals entry", () => {
    const breakevenPosition = { ...position, stopLoss: position.entry };

    const result = resolveOpenPositionDecision(breakevenPosition, {
      high: 1.104,
      low: 1.1005,
      lastClose: 1.102,
    });

    expect(result.managementAction).not.toBe("BREAKEVEN_NOTIFY");
  });

  test("SHORT position reaching 1R triggers breakeven notify", () => {
    const shortPosition = {
      direction: "SHORT" as const,
      entry: "1.1000",
      stopLoss: "1.1040",
      takeProfit1: "1.0920",
    };

    const result = resolveOpenPositionDecision(shortPosition, {
      high: 1.101,
      low: 1.0955,
      lastClose: 1.096,
    });

    expect(result).toMatchObject({
      decision: "HOLD",
      managementAction: "BREAKEVEN_NOTIFY",
    });
  });

  test("reaching TP directly (without a prior 1R check in a separate run) closes as before, not a breakeven notify", () => {
    const result = resolveOpenPositionDecision(position, {
      high: 1.109,
      low: 1.101,
      lastClose: 1.108,
    });

    expect(result).toMatchObject({
      decision: "CLOSE",
      managementAction: "TAKE_PROFIT_CLOSE",
    });
  });

  test("not yet at 1R stays HOLD with managementAction NONE", () => {
    const result = resolveOpenPositionDecision(position, {
      high: 1.102,
      low: 1.099,
      lastClose: 1.1,
    });

    expect(result).toMatchObject({
      decision: "HOLD",
      managementAction: "NONE",
    });
  });
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run tests/charts/position-decision.test.ts`
Expected: FAIL — the three new "breakeven notify" tests get `managementAction: "NONE"` instead of `"BREAKEVEN_NOTIFY"` (the 1R check does not exist yet). The "reaching TP directly" and "not yet at 1R" tests should already pass (they exercise existing behavior) — confirm they do, since they anchor that Task 4 doesn't change existing TP/SL/HOLD behavior.

- [ ] **Step 8: Implement the 1R breakeven check**

In `src/charts/position-decision-volman.ts`, add `buildBreakevenDecision` after `buildCloseDecision` (after line 42):

```typescript
function buildBreakevenDecision(comment: string): PositionDecisionOutcome {
  return {
    decision: "HOLD",
    confidence: 90,
    comment,
    managementAction: "BREAKEVEN_NOTIFY",
  };
}
```

Insert the 1R check into `resolveOpenPositionDecision`, between the closing `}` of the LONG/SHORT `if`/`else` block and the `if (emaContext)` block (i.e., replace lines 81-83):

```typescript
  }

  const alreadyAtBreakeven = Math.abs(entry - stopLoss) < 1e-9;
  if (!alreadyAtBreakeven) {
    const oneRLevel = 2 * entry - stopLoss;
    const reached1R =
      position.direction === "LONG" ? stats.high >= oneRLevel : stats.low <= oneRLevel;
    if (reached1R) {
      return buildBreakevenDecision(
        `Giá đã đạt 1R (${formatPrice(oneRLevel)}) — dời SL về entry ${formatPrice(entry)}.`,
      );
    }
  }

  if (emaContext) {
```

(The formula `oneRLevel = 2 * entry - stopLoss` is algebraically equivalent to `entry + R` for LONG and `entry - R` for SHORT, where `R = |entry - stopLoss|` — verified: LONG entry=1.10, SL=1.096 → R=0.004 → oneR = 1.10+0.004=1.104 = 2×1.10−1.096 = 1.104 ✓. SHORT entry=1.10, SL=1.104 → R=0.004 → oneR=1.10−0.004=1.096 = 2×1.10−1.104=1.096 ✓.)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/charts/position-decision.test.ts`
Expected: PASS (all tests).

- [ ] **Step 10: Commit**

```bash
git add src/charts/position-decision-volman.ts tests/charts/position-decision.test.ts
git commit -m "feat: notify and prep breakeven when an open position reaches 1R"
```

---

### Task 5: Wire the breakeven notification into open-position checks

**Files:**
- Modify: `src/charts/positions-repository-volman.ts`
- Modify: `src/shared/telegram-volman.ts`
- Modify: `src/charts/check-open-trades-runner-volman.ts`
- Test: `tests/charts/positions-repository-volman.test.ts`
- Test: `tests/shared/telegram-volman.test.ts`
- Test: `tests/charts/check-open-trades-runner-volman.test.ts`

**Interfaces:**
- Consumes: `PositionDecisionOutcome` with `managementAction: "BREAKEVEN_NOTIFY"` (Task 4); `deriveManagementPatch` returning `closePosition: false` for that action (Task 4).
- Produces: `applyBreakevenStopLoss(id: number, entry: string): Promise<void>` (repository), `buildBreakevenReminderMessage(position: { id: number; pair: string; direction: "LONG" | "SHORT"; setup: string | null; entry: string }, comment: string): string` (telegram). Nothing else depends on these.

- [ ] **Step 1: Write the failing test for the repository function**

Add to `tests/charts/positions-repository-volman.test.ts`, inside `describe("charts/positions-repository-volman", ...)`:

```typescript
  test("applyBreakevenStopLoss updates stop_loss to the given entry price", async () => {
    await repository.applyBreakevenStopLoss(1, "1.1000");

    expect(dbState.update).toHaveBeenCalledWith({ stop_loss: "1.1000" });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/charts/positions-repository-volman.test.ts`
Expected: FAIL — `repository.applyBreakevenStopLoss is not a function`.

- [ ] **Step 3: Implement `applyBreakevenStopLoss`**

In `src/charts/positions-repository-volman.ts`, add after `closePosition` (after line 443, before `export type BinanceExecutionDetails`):

```typescript
export async function applyBreakevenStopLoss(id: number, entry: string): Promise<void> {
  const { error } = await (getDb().from("open_positions_volman") as any)
    .update({ stop_loss: entry })
    .eq("id", id);

  if (error) throw new Error(`applyBreakevenStopLoss failed: ${error.message}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/charts/positions-repository-volman.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/charts/positions-repository-volman.ts tests/charts/positions-repository-volman.test.ts
git commit -m "feat: add applyBreakevenStopLoss repository function"
```

- [ ] **Step 6: Write the failing test for the Telegram message builder**

Open `tests/shared/telegram-volman.test.ts` and find the `describe("buildPositionClosedMessage", ...)` block (around line 351) to match its style. Add a new `describe` block after it:

```typescript
describe("buildBreakevenReminderMessage", () => {
  test("renders a breakeven reminder with pair, direction, and entry", () => {
    const message = buildBreakevenReminderMessage(
      {
        id: 7,
        pair: "EUR/USD",
        direction: "LONG",
        setup: "RB",
        entry: "1.1000",
      },
      "Giá đã đạt 1R (1.1040) — dời SL về entry 1.1000.",
    );

    expect(message).toContain("#7");
    expect(message).toContain("EUR/USD");
    expect(message).toContain("LONG");
    expect(message).toContain("1R");
    expect(message).toContain("1.1000");
  });
});
```

Add `buildBreakevenReminderMessage` to the import list at the top of the test file (alongside `buildPositionClosedMessage`, `buildPositionDecisionMessage`).

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/shared/telegram-volman.test.ts`
Expected: FAIL — `buildBreakevenReminderMessage is not a function` (or not exported).

- [ ] **Step 8: Implement `buildBreakevenReminderMessage`**

In `src/shared/telegram-volman.ts`, add after `buildPositionClosedMessage` (after line 356):

```typescript
export function buildBreakevenReminderMessage(
  position: {
    id: number;
    pair: string;
    direction: "LONG" | "SHORT";
    setup: string | null;
    entry: string;
  },
  comment: string,
): string {
  const lines = [
    `🎯 *Vị thế #${position.id} đạt 1R* — ${position.pair} ${position.direction}`,
    position.setup ? `📋 ${position.setup}` : "",
    comment,
    `👉 Dời Stop Loss về entry (${position.entry}) trên sàn để bảo toàn hoà vốn.`,
  ];

  return lines.filter((line) => line !== "").join("\n");
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/shared/telegram-volman.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared/telegram-volman.ts tests/shared/telegram-volman.test.ts
git commit -m "feat: add breakeven reminder Telegram message builder"
```

- [ ] **Step 11: Write the failing test for the runner wiring**

Add to `tests/charts/check-open-trades-runner-volman.test.ts`, inside `describe(...)`. First add `applyBreakevenStopLoss: vi.fn()` to the `repository` hoisted mock object (alongside `buildPositionManagementPatch`, `updatePositionDecision`, `closePosition`, `loadOpenPositions`) and `buildBreakevenReminderMessage: vi.fn()` to the `telegram` hoisted mock object, then add:

```typescript
  test("sends a breakeven reminder and moves stop-loss to entry without closing the position", async () => {
    const decision = {
      decision: "HOLD" as const,
      confidence: 90,
      comment: "Giá đã đạt 1R (1.1040) — dời SL về entry 1.1000.",
      managementAction: "BREAKEVEN_NOTIFY" as const,
    };
    decisions.resolveOpenPositionDecision.mockReturnValue(decision);
    repository.buildPositionManagementPatch.mockReturnValue({
      patch: {
        lastManagementAction: "BREAKEVEN_NOTIFY",
        lastManagementComment: decision.comment,
      },
      closePosition: false,
    });
    repository.applyBreakevenStopLoss.mockResolvedValue(undefined);
    telegram.buildBreakevenReminderMessage.mockReturnValue("breakeven reminder");

    const sentNotification = await processPosition(position as any);

    expect(repository.applyBreakevenStopLoss).toHaveBeenCalledWith(1, position.entry);
    expect(telegram.buildBreakevenReminderMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, pair: "EUR/USD" }),
      decision.comment,
    );
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("breakeven reminder"),
    );
    expect(repository.closePosition).not.toHaveBeenCalled();
    expect(sentNotification).toBe(true);
  });
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `npx vitest run tests/charts/check-open-trades-runner-volman.test.ts`
Expected: FAIL — `repository.applyBreakevenStopLoss` is not called (the wiring does not exist yet); `sentNotification` is `false`.

- [ ] **Step 13: Wire the breakeven branch into `processPosition`**

In `src/charts/check-open-trades-runner-volman.ts`, add the import (alongside the existing `positions-repository-volman.js` import on line 3):

```typescript
import { buildPositionManagementPatch, closePosition, loadOpenPositions, updatePositionDecision, applyBreakevenStopLoss } from "./positions-repository-volman.js";
```

And the telegram import (line 4):

```typescript
import { buildPositionClosedMessage, buildBreakevenReminderMessage } from "../shared/telegram-volman.js";
```

Replace `processPosition` (lines 62-92):

```typescript
export async function processPosition(position: Awaited<ReturnType<typeof loadOpenPositions>>[number]): Promise<boolean> {
  const decision = await evaluateOpenPosition(position);
  const { patch, closePosition: shouldClose } = buildPositionManagementPatch(position, decision);
  await updatePositionDecision(position.id, decision, patch);

  if (decision.managementAction === "BREAKEVEN_NOTIFY" && !shouldClose) {
    await applyBreakevenStopLoss(position.id, position.entry);
    const breakevenMessage = buildBreakevenReminderMessage(
      {
        id: position.id,
        pair: position.pair,
        direction: position.direction,
        setup: position.setup,
        entry: position.entry,
      },
      decision.comment,
    );
    await sendMessage(`${breakevenMessage}\n\n*Cập nhật lúc:* ${formatCheckedAt()}`);
    return true;
  }

  if (shouldClose) {
    const snapshot = await closePosition(position, decision, patch);
    const closedMessage = buildPositionClosedMessage(
      {
        id: position.id,
        pair: position.pair,
        direction: position.direction,
        setup: position.setup,
        entry: position.entry,
        openedAt: position.openedAt
          ? new Date(position.openedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
          : null,
      },
      snapshot,
      {
        isFailSafeClose:
          position.binanceExecutionStatus === "failed" ||
          position.binanceExecutionStatus === "close_failed",
      },
    );
    await sendMessage(`${closedMessage}\n\n*Cập nhật lúc:* ${formatCheckedAt()}`);
    return true;
  }

  return false;
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `npx vitest run tests/charts/check-open-trades-runner-volman.test.ts`
Expected: PASS (all tests, including the new one and the two pre-existing ones from Step 11's context).

- [ ] **Step 15: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all test files green, no TypeScript errors.

- [ ] **Step 16: Commit**

```bash
git add src/charts/check-open-trades-runner-volman.ts tests/charts/check-open-trades-runner-volman.test.ts
git commit -m "feat: send breakeven reminder and move stop-loss to entry when a position reaches 1R"
```

---

### Task 6: Verify Binance live trading stays disabled

This task has no code changes — `BINANCE_LIVE_TRADING_ENABLED` and `BINANCE_LIVE_TRADING_ENABLED_VOLMAN` already default to `false` in `src/charts/binance-futures-config-env.ts:10,57` (`readBooleanEnv(key, false)`), and no file in this repository (including `.github/workflows/`) sets either to `true`. Confirmed by:

```bash
grep -rn "BINANCE_LIVE_TRADING_ENABLED" src .github 2>/dev/null
```

which only shows the two default-`false` getter definitions in `binance-futures-config-env.ts` — no override anywhere in the repo.

The remaining risk is outside this repository: wherever the bot is actually deployed (a local `.env` file, GitHub Actions repository secrets/variables, or a hosting platform's environment panel) may have one or both of these set to `true` already. This plan cannot inspect or change that from the repo.

- [ ] **Step 1: Manually verify the deployment environment**

Check every place environment variables are supplied to the running bot (this is environment-specific — check whichever of these apply):
- Local `.env` file (if the bot runs locally): open it and confirm `BINANCE_LIVE_TRADING_ENABLED` and `BINANCE_LIVE_TRADING_ENABLED_VOLMAN` are either absent or set to `false`.
- GitHub Actions: repo Settings → Secrets and variables → Actions, check both Secrets and Variables tabs for these two names.
- Any other hosting platform's environment/config panel (e.g. Railway, Render, a VPS's systemd/pm2 env file) — check for the same two names.

If either is set to `true` anywhere, change it to `false` (or remove it, since the code default is already `false`) through that platform's own interface — this is a manual, non-code, non-git-tracked action outside this plan's scope.

- [ ] **Step 2: Report back**

No commit for this task (no files changed). Report to the user which locations were checked and what was found, so they can confirm Binance execution is off before the other tasks' signal-only behavior is relied upon.

---

## Final Verification

- [ ] Run the full suite once more after all tasks: `npm test` — expect all files green.
- [ ] Run `npx tsc --noEmit` (or the project's existing typecheck script, if one exists — check `package.json` `scripts` first) to confirm no type errors were introduced across the five tasks.
