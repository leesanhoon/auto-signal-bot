# Review: 04-tests — APPROVED

## Verdict: APPROVED

## Checked against plan.md / task.md

Read `tests/charts/setup-backtest.test.ts:152-422` (`describe("runSetupBacktest — pending fill mode")`) in full and traced each assertion against the actual pending-order state machine in `src/charts/setup-backtest.ts:137-159, 216-224`.

1. **Immediate backward-compat** (`test.ts:153-200`): runs `runSetupBacktest(candles, pair, tf)` (defaults) vs the same call with explicit `"fixed", 0, 3, "immediate"`, and asserts trade count and per-trade `entryIndex/entryPrice/exitIndex/outcome` are identical. This correctly proves the default parameter values match the explicit ones — genuinely tests backward compatibility, not just a tautology, since it compares two independently-constructed reports field by field.

2. **Pending fill on touch** (`test.ts:202-271`): fixture extends `buildImmediateRbCandles()` (trigger at index 31, entry ≈101.1 per RB setup geometry) with 2 bars whose `high` (100.5, 100.6) stay below entry, then a 3rd bar with `high=101.4` that crosses entry. Asserts exactly 1 trade, `entryIndex > 31` and `entryIndex !== 31` (proves deferred fill, not immediate), and `pendingStats = {signalsSeen:1, filled:1, cancelledBeforeFill:0, expired:0}`. This correctly targets the trigger condition at `setup-backtest.ts:147` (`high >= entry` for LONG).

3. **Invalidation SL-before-entry** (`test.ts:273-318`): adds one bar right after trigger with `low=99.0` (below stopLoss ≈99.1) while `high=101.0` stays below entry (≈101.1), so only the SL side is touched, never the entry. Asserts zero trades and `cancelledBeforeFill:1, filled:0`. Correctly exercises the invalidation branch at `setup-backtest.ts:142-145`.

4. **Expiry after pendingExpiryBars** (`test.ts:320-374`): adds bars whose `high`/`low` stay strictly inside (entry≈101.1, stopLoss≈99.1) for longer than `pendingExpiryBars=2` from `orderStartIndex=32`, i.e. `deadlineIndex=33`. Asserts zero trades, `expired:1`. Correctly exercises the expiry branch at `setup-backtest.ts:154-157` (`index >= pendingOrder.deadlineIndex`).

5. **Priority invalidation-over-fill on same candle** (`test.ts:376-421`): single bar with `high=101.3` (crosses entry) AND `low=99.0` (crosses SL) simultaneously. Asserts zero trades, `cancelledBeforeFill:1, filled:0`. This correctly matches the actual code order in `setup-backtest.ts:142-158`, where the `invalidated` check runs strictly before the `triggered` check within the same iteration — so on a bar that satisfies both conditions, invalidation always wins. The test asserts the exact behavior the engine implements, not just what's documented.

All 5 tests are meaningfully differentiated (different candle geometry, not copy-pasted with only assertion changes), fixture values are consistent with the RB setup's known entry/stopLoss levels from `buildImmediateRbCandles()`, and each test isolates exactly one state-machine branch. No test is vacuously true (e.g., no test merely checks `toBeDefined()` without checking exact counts).

## Verification run by reviewer

- `npm run build` — passes, zero TypeScript errors.
- `npm run test` — 74 test files / 791 tests total pass (includes the 6 original + 5 new `setup-backtest.test.ts` cases, 11 total in that file, matching result.md's reported output). No regressions elsewhere.

## Out-of-scope compliance

Confirmed only `tests/charts/setup-backtest.test.ts` was modified; no source files (`setup-backtest.ts`, `setup-backtest-runner.ts`, `setup-backtest-compare-runner.ts`) were touched by this subtask, and no bug was found in the pending-order engine while reviewing (matches result.md's "no deviations" claim).

## Notes

None blocking.
