# Volman ATR-Snapshot Consistency Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 Volman setup detectors (BB, RB, ARB, IRB) so that compression-window tightness classification (and, for ARB, the EMA-distance gate) uses the ATR value from the window's own last candle (`endIndex`) instead of the ATR value from the breakout candle (`index`) — the same ATR snapshot that `detectCompression()` already used to validate the window in the first place.

**Architecture:** Each of the 4 files calls `detectCompression(candles, ma21, atr14, index - 1, windowSize, kBlock)`, which internally validates the returned `CompressionWindow` using `atr14[endIndex]` (where `endIndex = index - 1`). Each file then reuses a local `atr` variable — currently `ctx.atr14[index]` — for `classifyCompressionTightness(...)` and (in ARB only) the `maxEmaDistance` gate. In BB/RB/ARB, the `ruleTrace` line that prints the tightness decision (`` `Nen ${tightness} (range=..., max=${(kBlock * atr).toFixed(5)})` ``) *also* reads that same stale `atr`, so fixing only the `classifyCompressionTightness` argument would leave the logged `max=` value inconsistent with the tightness label it's describing (confirmed by manually applying the partial fix and observing exactly this mismatch). The fix therefore introduces one named local (e.g. `blockAtr` / `rangeAtr`) holding `ctx.atr14[<window>.endIndex]!`, and uses that local for the classification call, the EMA-distance gate (ARB), and the trace string — leaving every other use of `ctx.atr14[index]` (bodyRatio, slope, top-of-function guards) untouched.

**Tech Stack:** TypeScript, Vitest, existing `src/charts/setups/*.ts` + `src/charts/indicators.ts` numeric detector code — no new dependencies.

## Global Constraints

- TypeScript strict mode (existing `tsconfig.json` — do not weaken it).
- Do not change any behavior for `ctx.atr14[index]` uses that are NOT the compression-window tightness/EMA-distance checks identified in the spec (bodyRatio, slope calculations, top-of-function null guards stay as-is).
- Do not modify `src/charts/indicators.ts` (`detectCompression`, `classifyCompressionTightness`) — only the 4 call sites in `src/charts/setups/{bb,rb,arb,irb}.ts`.
- `npm run build` and `npm run test` must pass after every task.

---

### Task 1: Fix BB (Block Break) tightness classification

**Files:**
- Modify: `src/charts/setups/bb.ts:68-69`
- Test: `tests/charts/setups.test.ts`

**Interfaces:**
- Consumes: `detectBb(candles: Candle[], index: number, ctx: DetectionContext): DetectedSignal | null` (existing export, signature unchanged).
- Produces: nothing new consumed by other tasks — each task is independent.

- [ ] **Step 1: Write the failing test**

Open `tests/charts/setups.test.ts`. Inside the existing `describe("BB — Block Break", ...)` block (after the existing `test("detects BB when block is ready ...)` test, before the closing `});` of the describe block), add:

```typescript
  test("classifies a block as LOOSE using the block's own ATR, not the breakout candle's inflated ATR", () => {
    // A gentle uptrend (drift 0.0046/candle) keeps EMA21 close to price (BB requires
    // block.distanceToEma <= 0.35 ATR) while |slope| still clears the 0.15 threshold.
    // The block (index 41-44) has range 0.1538, which is LOOSE relative to its own
    // ATR (atr14[44] = 0.14) but would misclassify as TIGHT if the breakout candle's
    // inflated ATR (atr14[45], driven by a large high-low wick) were used instead.
    const drift = 0.0046;
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const base = 100 + i * drift;
      candles.push({ time: 1700000000000 + i * 3600000, open: base, high: base + 0.08, low: base - 0.06, close: base + 0.02, volume: 100 });
    }
    for (let i = 40; i < 45; i++) {
      const base = 100 + i * drift;
      candles.push({ time: 1700000000000 + i * 3600000, open: base, high: base + 0.08, low: base - 0.06, close: base + 0.02, volume: 90 });
    }
    const base45 = 100 + 45 * drift;
    candles.push({ time: 1700000000000 + 45 * 3600000, open: base45, high: 101.0, low: base45 - 0.3, close: 100.95, volume: 120 });

    const ctx = buildContext(candles);
    const last = candles.length - 1;
    const signal = detectBb(candles, last, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.ruleTrace.find((t) => t.startsWith("Nen "))).toBe(
      "Nen LOOSE (range=0.15380, max=0.16800)",
    );
    expect(signal!.confidence).toBe(65);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/setups.test.ts -t "classifies a block as LOOSE"`
Expected: FAIL — actual trace is `"Nen TIGHT (range=0.15380, max=0.32048)"` and actual confidence is `70` (current buggy code uses `atr14[45]` instead of `atr14[44]`).

- [ ] **Step 3: Implement the fix**

In `src/charts/setups/bb.ts`, find lines 68-69:

```typescript
  const tightness = classifyCompressionTightness(block, kBlock, atr);
  trace.push(`Nen ${tightness} (range=${block.range.toFixed(5)}, max=${(kBlock * atr).toFixed(5)})`);
```

Replace with:

```typescript
  const blockAtr = ctx.atr14[block.endIndex]!;
  const tightness = classifyCompressionTightness(block, kBlock, blockAtr);
  trace.push(`Nen ${tightness} (range=${block.range.toFixed(5)}, max=${(kBlock * blockAtr).toFixed(5)})`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/charts/setups.test.ts -t "BB"`
Expected: PASS — both the new test and the existing `"detects BB when block is ready"` test pass.

- [ ] **Step 5: Commit**

```bash
git add src/charts/setups/bb.ts tests/charts/setups.test.ts
git commit -m "fix: BB tightness classification uses the block's own ATR, not the breakout candle's"
```

---

### Task 2: Fix RB (Range Break) tightness classification

**Files:**
- Modify: `src/charts/setups/rb.ts:53-54`
- Test: `tests/charts/setups.test.ts`

**Interfaces:**
- Consumes: `detectRb(candles: Candle[], index: number, ctx: DetectionContext): DetectedSignal | null` (existing export, signature unchanged).
- Produces: nothing new consumed by other tasks.

- [ ] **Step 1: Write the failing test**

Inside the existing `describe("RB — Range Break", ...)` block (after the existing `test("detects RB on a confirmed range breakout" ...)` test), add:

```typescript
  test("classifies a range as LOOSE using the range's own ATR, not the breakout candle's inflated ATR", () => {
    // Same base setup as the existing RB fixture above, but with a much larger breakout
    // wick (high=103 instead of 101.45) that inflates atr14 at the breakout candle
    // (2.220) relative to the range's own last candle (2.085) — range=2.20 is LOOSE
    // against the range's own ATR but would misclassify as TIGHT against the inflated one.
    const candles: Candle[] = [];
    for (let i = 0; i < 24; i++) {
      const base = 100;
      candles.push({ time: 1700000000000 + i * 3600000, open: base, high: base + 1.1, low: base - 1.1, close: base, volume: 100 });
    }
    candles.push(
      { time: 1700000000000 + 24 * 3600000, open: 100, high: 101.0, low: 99.0, close: 100.0, volume: 90 },
      { time: 1700000000000 + 24 * 3600000, open: 100.0, high: 101.1, low: 99.1, close: 100.05, volume: 90 },
      { time: 1700000000000 + 25 * 3600000, open: 100.05, high: 101.05, low: 99.05, close: 100.02, volume: 90 },
      { time: 1700000000000 + 26 * 3600000, open: 100.02, high: 101.0, low: 99.0, close: 100.03, volume: 90 },
      { time: 1700000000000 + 27 * 3600000, open: 100.03, high: 101.08, low: 99.08, close: 100.04, volume: 90 },
      { time: 1700000000000 + 28 * 3600000, open: 100.04, high: 101.1, low: 99.1, close: 100.01, volume: 90 },
    );
    candles.push({
      time: 1700000000000 + 29 * 3600000,
      open: 100.3,
      high: 103,
      low: 99.9,
      close: 102.9,
      volume: 120,
    });

    const ctx = buildContext(candles);
    const last = candles.length - 1;
    const signal = detectRb(candles, last, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.ruleTrace.find((t) => t.startsWith("Nen "))).toBe(
      "Nen LOOSE (range=2.20000, max=4.16950)",
    );
    expect(signal!.confidence).toBe(50);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/setups.test.ts -t "classifies a range as LOOSE"`
Expected: FAIL — actual trace is `"Nen TIGHT (range=2.20000, max=4.44023)"` and actual confidence is `55`.

- [ ] **Step 3: Implement the fix**

In `src/charts/setups/rb.ts`, find lines 53-54:

```typescript
  const tightness = classifyCompressionTightness(range, kBlockRb, atr);
  trace.push(`Nen ${tightness} (range=${range.range.toFixed(5)}, max=${(kBlockRb * atr).toFixed(5)})`)
```

Replace with:

```typescript
  const rangeAtr = ctx.atr14[range.endIndex]!;
  const tightness = classifyCompressionTightness(range, kBlockRb, rangeAtr);
  trace.push(`Nen ${tightness} (range=${range.range.toFixed(5)}, max=${(kBlockRb * rangeAtr).toFixed(5)})`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/charts/setups.test.ts -t "RB"`
Expected: PASS — both the new test and the existing `"detects RB on a confirmed range breakout"` test pass.

- [ ] **Step 5: Commit**

```bash
git add src/charts/setups/rb.ts tests/charts/setups.test.ts
git commit -m "fix: RB tightness classification uses the range's own ATR, not the breakout candle's"
```

---

### Task 3: Fix ARB (Advanced Range Break) tightness classification and EMA-distance gate

**Files:**
- Modify: `src/charts/setups/arb.ts:46-47`, `src/charts/setups/arb.ts:94`
- Test: `tests/charts/setups.test.ts`

**Interfaces:**
- Consumes: `detectArb(candles: Candle[], index: number, ctx: DetectionContext): DetectedSignal | null` (existing export, signature unchanged).
- Produces: nothing new consumed by other tasks.

- [ ] **Step 1: Write the failing test**

Inside the existing `describe("ARB — Advanced Range Break", ...)` block (after the existing 3 tests, before the closing `});`), add:

```typescript
  test("classifies an ARB range as LOOSE using the range's own ATR, not the breakout candle's inflated ATR", () => {
    // 7 flat warm-up candles, 2 upper-edge false-break probes (needed for the >=2
    // edge-test gate), 16 flat candles forming a wide range (width 2.0), then a
    // breakout candle whose large high-low wick inflates atr14 at the breakout
    // (2.073) relative to the range's own last candle (1.776) — range=2.00 is LOOSE
    // against the range's own ATR but would misclassify as TIGHT against the inflated one.
    const flatW = 2.0;
    const candles: Candle[] = [];
    for (let i = 0; i < 7; i++) {
      candles.push({ time: 1700000000000 + i * 3600000, open: 100, high: 100.05, low: 99.95, close: 100.0, volume: 100 });
    }
    candles.push(
      { time: 1700000000000 + 7 * 3600000, open: 100, high: 100 + flatW / 2 + 0.08, low: 99.97, close: 100.0, volume: 100 },
      { time: 1700000000000 + 8 * 3600000, open: 100, high: 100 + flatW / 2 + 0.06, low: 99.98, close: 100.0, volume: 100 },
    );
    for (let i = 9; i < 25; i++) {
      candles.push({ time: 1700000000000 + i * 3600000, open: 100, high: 100 + flatW / 2, low: 100 - flatW / 2, close: 100.01, volume: 100 });
    }
    candles.push({
      time: 1700000000000 + 25 * 3600000,
      open: 100.1,
      high: 103.0,
      low: 100 - flatW / 2,
      close: 100 + flatW / 2 + 0.4,
      volume: 120,
    });

    const ctx = buildContext(candles);
    const last = candles.length - 1;
    const signal = detectArb(candles, last, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.setup).toBe("ARB");
    expect(signal!.direction).toBe("LONG");
    expect(signal!.ruleTrace.find((t) => t.startsWith("Nen "))).toBe(
      "Nen LOOSE (range=2.00000, max=3.55276)",
    );
    expect(signal!.confidence).toBe(70);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/setups.test.ts -t "classifies an ARB range as LOOSE"`
Expected: FAIL — actual trace is `"Nen TIGHT (range=2.00000, max=4.14573)"` and actual confidence is `75`.

- [ ] **Step 3: Implement the fix**

In `src/charts/setups/arb.ts`, find lines 46-47:

```typescript
  const tightness = classifyCompressionTightness(range, kBlockArb, atr);
  trace.push(`Nen ${tightness} (range=${range.range.toFixed(5)}, max=${(kBlockArb * atr).toFixed(5)})`)
```

Replace with:

```typescript
  const rangeAtr = ctx.atr14[range.endIndex]!;
  const tightness = classifyCompressionTightness(range, kBlockArb, rangeAtr);
  trace.push(`Nen ${tightness} (range=${range.range.toFixed(5)}, max=${(kBlockArb * rangeAtr).toFixed(5)})`)
```

Then find line 94 (further down the same function):

```typescript
  const maxEmaDistance = 0.5 * atr;
```

Replace with (reusing the `rangeAtr` local defined above, for the same window):

```typescript
  const maxEmaDistance = 0.5 * rangeAtr;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/charts/setups.test.ts -t "ARB"`
Expected: PASS — all 4 ARB tests (3 existing + 1 new) pass.

- [ ] **Step 5: Commit**

```bash
git add src/charts/setups/arb.ts tests/charts/setups.test.ts
git commit -m "fix: ARB tightness classification and EMA-distance gate use the range's own ATR"
```

---

### Task 4: Fix IRB (Inside Range Break) tightness classification for both ranges

**Files:**
- Modify: `src/charts/setups/irb.ts:169`, `src/charts/setups/irb.ts:170`
- Test: `tests/charts/setups.test.ts`

**Interfaces:**
- Consumes: `detectIrb(candles: Candle[], index: number, ctx: DetectionContext): DetectedSignal | null` (existing export, signature unchanged).
- Produces: nothing new consumed by other tasks.

- [ ] **Step 1: Write the failing test**

Inside the existing `describe("IRB — Inside Range Break", ...)` block (after the existing `test("detects IRB with nested ranges ..." )` test), add:

```typescript
  test("classifies RangeOuter as LOOSE using the range's own ATR, not the breakout candle's inflated ATR", () => {
    // Same RangeOuter/RangeInner fixture as the existing IRB test above, but with a
    // larger breakout wick (high=106 instead of 101.8) that inflates atr14 at the
    // breakout candle (1.299) relative to the ranges' own last candle, index 33
    // (0.632) — RangeOuter (width 1.5) is LOOSE against the ranges' own ATR but would
    // misclassify as TIGHT against the inflated one. RangeOuter's tightness label
    // doesn't feed the confidence bonus (only RangeInner's does), so confidence is
    // unchanged by this fix — only the ruleTrace label differs.
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      const base = 100;
      candles.push({
        time: 1700000000000 + i * 3600000,
        open: base, high: base + 0.2, low: base - 0.2, close: base + 0.05,
        volume: 100,
      });
    }
    const outerVals: Array<[number, number, number]> = [
      [99.8, 100.9, 100.2], [99.7, 101.0, 100.5], [99.9, 100.8, 100.1], [99.65, 101.05, 100.6],
      [99.85, 100.85, 99.9], [99.7, 101.0, 100.4], [99.9, 100.75, 100.05], [99.6, 101.1, 100.5],
      [99.8, 100.9, 100.15], [99.7, 101.0, 100.6],
    ];
    outerVals.forEach(([low, high, close], i) => {
      const t = 20 + i;
      candles.push({ time: 1700000000000 + t * 3600000, open: close - 0.1, high, low, close, volume: 100 });
    });
    const innerVals: Array<[number, number, number]> = [
      [100.28, 100.42, 100.35],
      [100.3, 100.4, 100.33],
      [100.27, 100.38, 100.32],
      [100.29, 100.41, 100.36],
    ];
    innerVals.forEach(([low, high, close], i) => {
      const t = 30 + i;
      candles.push({ time: 1700000000000 + t * 3600000, open: close - 0.02, high, low, close, volume: 90 });
    });
    candles.push({
      time: 1700000000000 + 34 * 3600000,
      open: 100.5, high: 106, low: 100.45, close: 101.6,
      volume: 120,
    });

    const ctx = buildContext(candles);
    const last = candles.length - 1;
    const signal = detectIrb(candles, last, ctx);

    expect(signal).not.toBeNull();
    expect(signal!.ruleTrace).toContain("RangeInner TIGHT, RangeOuter LOOSE");
    expect(signal!.confidence).toBe(40);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/charts/setups.test.ts -t "classifies RangeOuter as LOOSE"`
Expected: FAIL — actual `ruleTrace` contains `"RangeInner TIGHT, RangeOuter TIGHT"` instead.

- [ ] **Step 3: Implement the fix**

In `src/charts/setups/irb.ts`, find lines 169-170:

```typescript
  const tightnessInner = classifyCompressionTightness(rangeInner, kBlockInner, atr);
  const tightnessOuter = classifyCompressionTightness(rangeOuter, kBlockOuter, atr);
```

Replace with:

```typescript
  const tightnessInner = classifyCompressionTightness(rangeInner, kBlockInner, ctx.atr14[rangeInner.endIndex]!);
  const tightnessOuter = classifyCompressionTightness(rangeOuter, kBlockOuter, ctx.atr14[rangeOuter.endIndex]!);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/charts/setups.test.ts -t "IRB"`
Expected: PASS — both the new test and the existing `"detects IRB with nested ranges and a breakout through both ranges"` test pass.

- [ ] **Step 5: Commit**

```bash
git add src/charts/setups/irb.ts tests/charts/setups.test.ts
git commit -m "fix: IRB tightness classification uses each range's own ATR, not the breakout candle's"
```

---

### Task 5: Full regression pass

**Files:**
- None modified — verification only.

**Interfaces:**
- Consumes: all 4 fixes from Tasks 1-4.
- Produces: nothing — this is the final verification gate for the plan.

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — every test file under `tests/`, including `tests/charts/setups.test.ts`, `tests/charts/deterministic-pipeline.test.ts`, `tests/charts/setup-sb-runner.test.ts`, and `tests/charts/setup-backtest.test.ts`, passes with no failures.

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`
Expected: PASS — no type errors (the `ctx.atr14[<window>.endIndex]!` non-null assertions must type-check cleanly since `<window>.endIndex` is a `number` and `ctx.atr14` is `(number | null)[]`).

- [ ] **Step 3: Commit if any lockfile/build artifact changed**

```bash
git status --short
```

If clean (no output), no commit needed — Tasks 1-4 already committed the only changes. If `dist/` artifacts changed from the build step, do not commit them unless the project's existing convention already tracks `dist/` (check `git log --oneline -- dist/charts/analyzer-volman.js` — if it has prior commits, `dist/` is tracked and should be rebuilt and committed; otherwise leave it untracked).

- [ ] **Step 4 (manual, optional): Compare backtest win-rate before/after**

This step requires live Twelve Data API credentials configured in the environment (`.env` — see `src/charts/ohlc-provider.ts`) and is not part of the automated task loop; run it manually if credentials are available:

```bash
npx tsx src/charts/setup-backtest-compare-runner.ts
```

Eyeball the output: total ARB/BB/RB/IRB signal counts and win-rate should not collapse to near-zero (which would indicate the fix over-corrected and now rejects almost everything) and should not be numerically identical to a pre-fix run (which would indicate the fix had no real effect on live data). Record the before/after numbers in the task's `result.md` per `CLAUDE.md`'s Worker workflow if this repo's manual Lead/Worker process is in use.
