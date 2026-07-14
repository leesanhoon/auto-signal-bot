# BB Box Window Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BB (Block Break) setup detector prefer the widest compression window that still satisfies the nén (compression) threshold, instead of always stopping at the smallest/nearest window, so the drawn box reflects support/resistance built up over more candles.

**Architecture:** `src/charts/setups/bb.ts` already loops `for (const w of windowSizes) { ...; if (block !== null) break; }` over `COMPRESSION_PARAMS.BB.windows` and takes the first window that passes `detectCompression()`. No logic in `bb.ts` or `indicators.ts` needs to change — reordering `COMPRESSION_PARAMS.BB.windows` to descending order, and adding two larger window sizes, is sufficient to flip the selection from "smallest passing window" to "largest passing window".

**Tech Stack:** TypeScript, Vitest, tsx (for scratch verification only, not part of the plan).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-bb-box-window-accuracy-design.md`.
- Only `src/charts/setups/compression-params.ts` and `tests/charts/setups.test.ts` may be modified. Do not touch `bb.ts`, `indicators.ts`, `RB`/`IRB`/`ARB` params, or any other setup file — out of scope per spec.
- `kBlock` for BB stays `1.2` for every window size (spec requirement — do not loosen it).
- `BB.windows` final value must be `[10, 8, 6, 5, 4]` (descending order) — this exact array, not a re-sorted `[4,5,6,8,10]` (order matters: the loop breaks on first match, so descending = largest-first).
- Run `npm run build` and `npm run test` (full suite) before the final commit — both must pass with zero failures.

---

### Task 1: Add failing test proving BB currently picks the smallest window when a larger one would also qualify

**Files:**
- Modify: `tests/charts/setups.test.ts` (inside the existing `describe("BB — Block Break", ...)` block, after the two existing tests, i.e. after line 211 `});` that closes the "classifies a block as LOOSE..." test, before the closing `});` of the `describe` block at line 212).

**Interfaces:**
- Consumes: `detectBb` from `../../src/charts/setups/bb.js` (already imported at line 10), `buildContext` helper (already defined at line 33), `Candle` type (already imported at line 2). No new imports needed.
- Produces: nothing consumed by later tasks — this is a leaf test.

- [ ] **Step 1: Add the new test**

Insert this test immediately after the existing `test("classifies a block as LOOSE using the block's own ATR, not the breakout candle's inflated ATR", ...)` block (i.e. right after its closing `});` at line 211), still inside the same `describe("BB — Block Break", ...)`:

```typescript
  test("prefers the widest compression window that still satisfies the threshold", () => {
    // Same style fixture as the LOOSE test above, but with a much smaller drift
    // (0.001 instead of 0.0046) so windows up to 10 candles still satisfy
    // range <= kBlock * ATR. With BB.windows tried in descending order, the
    // detector must pick window=10 (the widest), not window=4.
    const drift = 0.001;
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
    expect(signal!.setup).toBe("BB");
    expect(signal!.geometry).toBeDefined();
    expect(signal!.geometry!.boxes).toHaveLength(1);
    // window=10 spans candles 35-44 (endIndex=44, startIndex=44-10+1=35).
    // The old ascending-order config picks window=4 (startIndex=41) instead.
    expect(signal!.geometry!.boxes[0].startIndex).toBe(35);
    expect(signal!.geometry!.boxes[0].endIndex).toBe(44);
    expect(signal!.geometry!.boxes[0].range).toBeCloseTo(0.149, 3);
    expect(signal!.geometry!.boxes[0].high).toBeCloseTo(100.124, 3);
    expect(signal!.geometry!.boxes[0].low).toBeCloseTo(99.975, 3);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/charts/setups.test.ts -t "prefers the widest compression window"`

Expected: FAIL — `signal!.geometry!.boxes[0].startIndex` is `41` (window=4, the current ascending-order behavior), not the expected `35`. This confirms the test reproduces the bug described in the spec.

- [ ] **Step 3: Commit**

```bash
git add tests/charts/setups.test.ts
git commit -m "test: add failing case for BB picking smallest compression window"
```

---

### Task 2: Fix BB window selection order and update the assertion it breaks

**Files:**
- Modify: `src/charts/setups/compression-params.ts:15` (the `BB` entry) and its surrounding comment block (lines 9-15).
- Modify: `tests/charts/setups.test.ts:207-209` (the `ruleTrace` assertion inside `test("classifies a block as LOOSE using the block's own ATR, not the breakout candle's inflated ATR", ...)`).

**Interfaces:**
- Consumes: nothing new.
- Produces: `COMPRESSION_PARAMS.BB.windows` becomes `[10, 8, 6, 5, 4]`, consumed by `src/charts/setups/bb.ts:60` (unchanged file, unchanged consumption).

- [ ] **Step 1: Reorder and extend `BB.windows` in `compression-params.ts`**

Replace the `BB` entry and its comment (current lines 9-15):

```typescript
  /**
   * BB — Block Break
   * Window [4,5,6], kBlock=1.2
   * Trend market, tight block near MA21, breakout in trend direction.
   * kBlock=1.2: phát hiện block chặt hơn (yêu cầu range nhỏ hơn).
   */
  BB: { windows: [4, 5, 6], kBlock: 1.2 },
```

with:

```typescript
  /**
   * BB — Block Break
   * Window [10,8,6,5,4] (thứ tự GIẢM DẦN), kBlock=1.2.
   * Trend market, tight block near MA21, breakout in trend direction.
   * kBlock=1.2: phát hiện block chặt hơn (yêu cầu range nhỏ hơn).
   *
   * Thứ tự giảm dần là chủ đích: bb.ts lặp qua `windows` và dừng ở window
   * ĐẦU TIÊN thỏa `range <= kBlock * ATR`, nên đảo thứ tự này tương đương
   * "ưu tiên chọn window nhiều nến nhất (block/vùng nén rộng nhất) mà vẫn
   * còn thỏa điều kiện nén, fallback dần xuống window nhỏ hơn nếu không có
   * vùng nén rộng hơn". Window gốc 4-6 đã backup-test validate; 8 và 10 mở
   * rộng thêm để bắt vùng nén hình thành qua nhiều nến hơn — không đổi
   * kBlock để không nới lỏng tiêu chuẩn nén chỉ vì window lớn hơn.
   */
  BB: { windows: [10, 8, 6, 5, 4], kBlock: 1.2 },
```

- [ ] **Step 2: Run the Task 1 test to verify it now passes**

Run: `npx vitest run tests/charts/setups.test.ts -t "prefers the widest compression window"`

Expected: PASS

- [ ] **Step 3: Run the full BB describe block to find the test broken by the reorder**

Run: `npx vitest run tests/charts/setups.test.ts -t "BB — Block Break"`

Expected: FAIL — `test("classifies a block as LOOSE using the block's own ATR, not the breakout candle's inflated ATR", ...)` fails. Its fixture (drift=0.0046) now satisfies `range <= kBlock * ATR` at window=6 (range=0.163, threshold=0.168) before it reaches window=4, so the detector picks window=6 instead of window=4. The `range` value in the `ruleTrace` assertion changes from `0.15380` (window=4) to `0.16300` (window=6); the `max` threshold (`0.16800`, driven by `kBlock * atr14[44]`, unaffected by window size) and `confidence` (`65`) stay the same.

- [ ] **Step 4: Update the stale assertion**

In `tests/charts/setups.test.ts`, inside `test("classifies a block as LOOSE using the block's own ATR, not the breakout candle's inflated ATR", ...)`, replace:

```typescript
    expect(signal!.ruleTrace.find((t) => t.startsWith("Nen "))).toBe(
      "Nen LOOSE (range=0.15380, max=0.16800)",
    );
    expect(signal!.confidence).toBe(65);
```

with:

```typescript
    expect(signal!.ruleTrace.find((t) => t.startsWith("Nen "))).toBe(
      "Nen LOOSE (range=0.16300, max=0.16800)",
    );
    expect(signal!.confidence).toBe(65);
```

Also update the comment above it (currently lines 183-188) so it stays accurate — replace:

```typescript
    // A gentle uptrend (drift 0.0046/candle) keeps EMA21 close to price (BB requires
    // block.distanceToEma <= 0.35 ATR) while |slope| still clears the 0.15 threshold.
    // The block (index 41-44) has range 0.1538, which is LOOSE relative to its own
    // ATR (atr14[44] = 0.14) but would misclassify as TIGHT if the breakout candle's
    // inflated ATR (atr14[45], driven by a large high-low wick) were used instead.
```

with:

```typescript
    // A gentle uptrend (drift 0.0046/candle) keeps EMA21 close to price (BB requires
    // block.distanceToEma <= 0.35 ATR) while |slope| still clears the 0.15 threshold.
    // BB.windows is tried widest-first ([10,8,6,5,4]); windows 10 and 8 fail the
    // compression check here, so window=6 (index 39-44) is the widest that passes,
    // with range 0.1630 — LOOSE relative to its own ATR (atr14[44] = 0.14) but would
    // misclassify as TIGHT if the breakout candle's inflated ATR (atr14[45], driven
    // by a large high-low wick) were used instead.
```

- [ ] **Step 5: Run the full BB describe block again**

Run: `npx vitest run tests/charts/setups.test.ts -t "BB — Block Break"`

Expected: PASS (3 tests: the original "detects BB when block is ready...", the updated "classifies a block as LOOSE...", and the new "prefers the widest compression window...").

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`

Expected: all test files pass, 0 failures (731 tests: the 730 from before this change plus the 1 new test added in Task 1).

- [ ] **Step 7: Run the build**

Run: `npm run build`

Expected: exits with no output and exit code 0 (no TypeScript errors).

- [ ] **Step 8: Commit**

```bash
git add src/charts/setups/compression-params.ts tests/charts/setups.test.ts
git commit -m "fix: BB block prefers widest compression window over smallest"
```
