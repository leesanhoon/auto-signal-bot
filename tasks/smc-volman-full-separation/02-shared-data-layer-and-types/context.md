# Context — Shared Data Layer & Type Splitting (Subtask 02)

## What Is This Subtask Part Of?

This is **Task 02 of 10** in the larger plan: **"Tách hoàn toàn SMC và Bob Volman thành 2 flow độc lập"**

Plan reference: `tasks/smc-volman-full-separation/plan.md`

---

## Why Split Types?

### Current Problem

`src/charts/chart-types.ts` is a "bag of types" that mixes:
- Infrastructure (data shapes from OHLC providers)
- Volman business logic (EMA-based setup patterns)
- SMC business logic (liquidity-zone setup patterns)

Example: `TradeSetup` type has BOTH Volman fields (`emaTouch`, `entryCondition`) AND SMC fields (`grade`, `score`, `liquidityTargets`) as optional fields.

**Consequences:**
- Unclear which fields a system actually uses
- Hard to evolve: changing SMC fields might accidentally affect Volman code
- Tests can't be specific: they test mixed logic
- Future developers don't know what's required vs optional

### The Solution

Split into 3 focused files:

| File | Purpose | Users |
|------|---------|-------|
| `chart-types-common.ts` | Infrastructure (OHLC, charts, orders) | Both Volman & SMC |
| `chart-types-volman.ts` | Volman-specific business types | Volman entrypoint + subtasks 04-07 |
| `chart-types-smc.ts` | SMC-specific business types | SMC entrypoint + subtasks 04-07 |

Each system imports what it needs. No ambiguity.

---

## What Stays Shared (OHLC Provider)

**Decision from plan.md:** Keep OHLC provider shared between both systems.

**Why?** 
- Both systems read the same price data (TwelveData)
- Both systems calculate the same candle statistics
- Splitting OHLC would duplicate code for no benefit
- Future: when Binance provider is added, it goes here (single place for both systems)

**Files that stay unchanged:**
- `src/charts/ohlc-provider.ts` — fetches candles from TwelveData
- `src/charts/ohlc-cache-repository.ts` — caches candles

Both systems will continue importing `Candle`, `CandleRangeStats`, etc. from here.

---

## Ranh Giới Cụ Thể

### Common (Infrastructure) — Imported by Both Systems

```
CandleRangeStats
ChartTimeframe (M15, M30, H1, H4, D1)
ChartOrderType (MARKET_NOW, BUY_STOP, SELL_STOP, BUY_LIMIT, SELL_LIMIT, WAIT_FOR_CONFIRMATION)
ChartConfig (name, symbol, interval, description, timeframe)
ChartAnalysisSource (symbol, timeframe, name, filepath, lastPrice)
ScreenshotResult (chart, buffer, filepath, lastPrice)
PendingOrderStatus (PENDING, TRIGGERED, EXPIRED, CANCELLED)
PendingOrder (the database record — common structure for both)
```

### Volman-Specific

```
TradeSetup (with emaTouch, entryCondition, currentPriceContext, detectionSource: "deterministic"|"ai")
PairSummary (with emaProximity field)
AnalysisResult
AnalysisStats
```

### SMC-Specific

```
TradeSetup (with grade, score, market, session, entryZone, liquidityTargets, caution, capitalManagement)
PairSummary (SMC version, simpler)
AnalysisResult
AnalysisStats
```

---

## Impact on Subsequent Subtasks

This subtask only affects **type organization**, not runtime behavior.

**Subtask 03+** will:
- Use `chart-types-volman.ts` in Volman-specific code
- Use `chart-types-smc.ts` in SMC-specific code
- Continue using `chart-types-common.ts` for shared infra types
- Gradually replace old `chart-types.ts` imports

**No code logic changes** — just imports updated.

---

## Documentation Fix

Current `docs/volman-numeric-engine.md` line 26 says:
```
OHLC Provider (MetaApi, H4)
```

This is stale. MetaApi is not in the codebase (only TwelveData is actually used).

**Change to:**
```
OHLC Provider (TwelveData, H4)
```

This is a documentation-only fix; no code impact.

---

## Clean-up Strategy

**Do NOT delete old `chart-types.ts` in this task.** 

Why? Existing code still imports from it. Deleting it now would break the build.

**Timeline:**
- **Task 02:** Create new split files (keep old file)
- **Tasks 03-09:** Gradually migrate imports from old → new files
- **Task 10:** Delete old `chart-types.ts` after all code is updated

This is safer than trying to migrate everything in one step.

---

## Success Criteria

1. ✅ 3 new files created with correct types
2. ✅ OHLC files unchanged
3. ✅ `npm run build` passes (no TypeScript errors)
4. ✅ `npm run test` passes (existing tests still work)
5. ✅ Old `chart-types.ts` still exists
6. ✅ Documentation updated (MetaApi → TwelveData)

This task is purely organizational — no behavioral changes.

---

## Estimated Effort

- **File creation:** ~30 minutes (copy + edit)
- **Build verification:** ~5 minutes
- **Test verification:** ~10 minutes
- **Documentation fix:** ~2 minutes

**Total:** ~45 minutes

---

## Common Pitfalls to Avoid

1. ❌ **Don't delete old `chart-types.ts`** — it breaks everything
2. ❌ **Don't change type logic** — only reorganize
3. ❌ **Don't miss `.js` extensions** — use `from "./chart-types-common.js"`
4. ❌ **Don't update all imports yet** — that's subtasks 03-09

---

## Files to Touch This Subtask

**Create:**
- `src/charts/chart-types-common.ts` (new)
- `src/charts/chart-types-volman.ts` (new)
- `src/charts/chart-types-smc.ts` (new)

**Update:**
- `docs/volman-numeric-engine.md` (fix MetaApi reference)

**Verify (no changes needed):**
- `src/charts/ohlc-provider.ts`
- `src/charts/ohlc-cache-repository.ts`

**Keep (don't delete):**
- `src/charts/chart-types.ts` (will be deleted in task 10)
