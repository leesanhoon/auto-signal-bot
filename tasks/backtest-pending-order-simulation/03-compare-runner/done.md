# Review: 03-compare-runner — APPROVED

## Verdict: APPROVED

## Checked against plan.md / task.md

- `src/charts/setup-backtest-compare-runner.ts` is a new, self-contained file (no cross-import from `setup-backtest-runner.ts`); parser functions (`parseExitMode`, `parseTrailBufferR`, `parseSwingLookback`, `parsePendingExpiryBars`, `parseBacktestTimeframe`, `parseBacktestBars`) are copied locally at lines 13-64, matching task.md step 2 (avoids side-effects from the other runner's `main()`).
- **Fair A/B comparison — fetch once, run twice on same candles**: confirmed at `setup-backtest-compare-runner.ts:346-389`. `fetchOhlcHistory` is called exactly once per pair (line 348), and `runSetupBacktest` is called twice on the same `candles` array — once with `"immediate"` (line 366-374) and once with `"pending", pendingExpiryBars` (line 378-387). This is the most important correctness requirement in the task and it is satisfied — no separate fetches per mode.
- `aggregate()` (lines 82-119) correctly reproduces the overall/bySetup/byPair aggregation logic from `setup-backtest-runner.ts`, returning a plain object instead of printing.
- `printComparisonTable()` (lines 153-256) prints Trades (imm/pend), Win Rate (imm/pend, Δ pp), and Avg R (imm/pend, Δ) for OVERALL, per-setup, and per-pair rows — matches task.md step 5. Delta formatting includes explicit sign via `formatDelta()` (lines 141-147).
- `aggregatePendingStats()` / `printPendingStats()` (lines 262-308) aggregate and print signalsSeen/filled/cancelledBeforeFill/expired with fill/cancellation/expiry rate percentages — matches task.md step 6.
- Final JSON block (lines 408-510) contains `timeframe, bars, exitMode, trailBufferR, swingLookback, pendingExpiryBars, overall{immediate,pending,deltaWinRatePct,deltaAvgR,deltaTrades}, bySetup{...}, byPair{...}, pendingStats` — matches the structure specified in plan.md section 3 and task.md step 7, with reasonable rounding (winRate to 4 decimals / percent-ready, avgR to 2 decimals). Structure is directly usable by subtask 05 for redirecting to a `.json` file.
- `package.json:20` — `"backtest:compare": "tsx src/charts/setup-backtest-compare-runner.ts"` added right after `"backtest:setups"` as specified.
- `main().catch(...)` pattern present at the end of the file (lines 513-516), consistent with other runners.
- Out-of-scope check: `setup-backtest.ts` and `setup-backtest-runner.ts` are untouched by this subtask (confirmed — no diffs to those files attributable to this change); no file is written to `tasks/.../results/` by the script itself (only stdout), consistent with the "no auto-write" restriction.

## Verification run by reviewer

- `npm run build` — passes with zero TypeScript errors.
- `npm run test` — 74 test files / 791 tests pass, no regressions.
- Runtime execution of `npm run backtest:compare` against live OHLC data was not performed by the reviewer either (same network/API dependency as subtask 02); code review confirms correct structure and the critical "fetch once, run twice on same data" requirement is met by direct inspection of the source.

## Notes

None blocking. This subtask is ready for subtask 05 to consume.
