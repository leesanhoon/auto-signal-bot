# Round 2 Fixes Summary

Successfully implemented all 7 findings from Round 2 code review.

## Status: ✅ ALL COMPLETE

**Build**: ✓ Pass  
**Tests**: ✓ 516/516 pass (50 test files)  
**Branch**: `feat/volman-numeric-engine`

---

## Fixes Applied

### Finding #9: Filter session/volatility fail-open → fail-safe
**File**: `src/charts/deterministic-pipeline.ts:59`  
**Issue**: When ATR data missing, entire filter was skipped (fail-open). Pairs with incomplete data sent signals outside trading hours.  
**Fix**: Changed logic to reject pair when `atrLast === null || atrAvg20d === null`.
```ts
// Before: if (atrLast !== null && atrAvg20d !== null) { ... }
// After: if (atrLast === null || atrAvg20d === null || !isTradableWindow(...)) { skip }
```

### Finding #10: Backtest engine missing detectSb
**File**: `src/charts/setup-backtest.ts`  
**Issue**: Production deterministic-pipeline had detectSb wiring, but setup-backtest didn't. Backtest ran different rule set than production.  
**Fix**: 
- Added imports: `detectSb`, `isFalseBreak`
- Implemented false-break detection loop (same as production)
- Added SB signal generation after 6 standard detectors

### Finding #11: OANDA retry not actually retrying HTTP status
**File**: `src/charts/ohlc-provider.ts:151, 171`  
**Issue**: Error thrown without `.status` field, so `withRetry` couldn't recognize 429/5xx as retryable.  
**Fix**: Attached `status` field to error object before throwing:
```ts
const err = new Error(`OANDA API trả về ${res.status} ...`);
(err as any).status = res.status;
throw err;
```

### Finding #12: Slope/bodyRatio/confidence duplicated across 5 setup files
**Files**: `src/charts/setups/{fb,bb,rb,arb,irb}.ts`  
**Issue**: Helper functions added to shared.ts but only used by dd.ts/sb.ts. 5 other files had duplicate inline logic.  
**Fix**:
- Updated imports in all 5 files to include `computeSlope`, `computeBodyRatio`, `applyStandardConfidenceAdjustments`
- Replaced inline calculations with function calls
- **Bonus**: fb.ts was missing bodyRatio penalty logic — now included

### Finding #13: D1/M15 fetched but never used
**File**: `src/charts/deterministic-pipeline.ts:39-42`  
**Issue**: Fetching D1 and M15 candles in parallel, but only H4 used. Wasted ~2/3 of OANDA API quota.  
**Fix**: Removed D1 and M15 fetches. Only fetch H4 (primary timeframe for all 7 detectors).

### Finding #14: Shared.ts helper functions untested
**File**: `tests/charts/setups/shared.test.ts` (new)  
**Issue**: No test coverage for `computeSlope`, `computeBodyRatio`, `applyStandardConfidenceAdjustments`.  
**Fix**: Created comprehensive test suite with 20 test cases covering:
- Edge cases (null values, zero ranges)
- Uptrend/downtrend slopes
- Weak/strong body ratios
- Confidence bonus/penalty combinations
- Clamping to [0, 100]

### Finding #15: Type-check weakened by `as any`
**File**: `src/charts/index.ts:52`  
**Issue**: Cache read path bypassed TypeScript type checking with `as any`.  
**Fix**: 
- Added `AnalysisResult` to imports from `chart-types.js`
- Changed `cached as any` → `cached as AnalysisResult`

---

## Impact

| Finding | Severity | Impact | Status |
|---------|----------|--------|--------|
| #9 | HIGH | No more signals outside trading hours | ✅ Fixed |
| #10 | HIGH | Backtest now tests same rules as production | ✅ Fixed |
| #11 | HIGH | OANDA rate-limit properly retried | ✅ Fixed |
| #12 | MEDIUM | Future refactors won't create inconsistencies | ✅ Fixed |
| #13 | MEDIUM | Saves ~67% of OANDA API quota usage | ✅ Fixed |
| #14 | LOW | Helper functions now have regression protection | ✅ Fixed |
| #15 | LOW | Type safety restored for cache reads | ✅ Fixed |

---

## Testing

All existing tests still pass + 20 new tests for shared.ts:

```
Test Files: 50 passed
Tests: 516 passed (no failures)
```

Ready for deployment.
