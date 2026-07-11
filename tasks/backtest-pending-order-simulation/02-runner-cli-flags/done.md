# Review: 02-runner-cli-flags — APPROVED

## Verdict: APPROVED

## Checked against plan.md / task.md

- `src/charts/setup-backtest-runner.ts:8` imports `FillMode` alongside `ExitMode` from `./setup-backtest.js` — matches task.md step 2.
- `src/charts/setup-backtest-runner.ts:32-41` — `parseFillMode` defaults to `"immediate"` for any value other than `"pending"` (case-insensitive, trimmed); `parsePendingExpiryBars` defaults to `2` for empty/non-integer/<1 values — matches task.md step 3 exactly.
- `src/charts/setup-backtest-runner.ts:84-85` reads `BACKTEST_FILL_MODE` / `BACKTEST_PENDING_EXPIRY_BARS` env vars in `main()`.
- `src/charts/setup-backtest-runner.ts:88-93` extends the log line with `fill=${fillMode}` and conditionally appends `(expiry=${pendingExpiryBars} bars)` when pending — matches task.md step 4.
- `src/charts/setup-backtest-runner.ts:131-140` — `runSetupBacktest(...)` call now passes `fillMode, pendingExpiryBars` as the 7th/8th positional args, matching the `runSetupBacktest` signature in `setup-backtest.ts:93-102`.
- `src/charts/setup-backtest-runner.ts:145` — `printReport(allReports, timeframe, exitMode, fillMode)` passes the new 4th arg.
- `src/charts/setup-backtest-runner.ts:149-160` — `printReport` signature and header (`fill=${fillMode}`) updated correctly.
- `src/charts/setup-backtest-runner.ts:218-232` — `PENDING ORDER STATS` block only prints when `fillMode === "pending"`, aggregates `pendingStats` across all pair reports with a null-guard (`if (!report.pendingStats) continue;`), and computes percentages with a `signalsSeen > 0` guard to avoid division by zero.

## Backward compatibility

Confirmed by reading the code path: when `BACKTEST_FILL_MODE` is unset, `parseFillMode(undefined)` returns `"immediate"`, `runSetupBacktest` receives `fillMode="immediate"` which is the pre-existing default, and `printReport` only adds `fill=immediate` to the header string plus skips the new PENDING ORDER STATS block entirely — no other output changes. This matches the plan's requirement that immediate mode stays byte-identical apart from the accepted header addition.

## Verification run by reviewer

- `npm run build` — passes with zero TypeScript errors (verified independently, not just trusting result.md).
- `npm run test` — 74 test files / 791 tests all pass, no regressions from this change.

## Notes

- Runtime verification of `BACKTEST_FILL_MODE=pending npm run backtest:setups` against live OHLC data was not performed by Worker (network/API dependency noted in result.md); this is acceptable per the task's own acceptance criteria fallback clause ("build pass vẫn coi là đủ evidence tối thiểu"), and the code path was independently traced above.
