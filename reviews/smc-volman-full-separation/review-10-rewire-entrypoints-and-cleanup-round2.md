# Review Round 2 — Subtask 10: Rewire Entrypoints & Cleanup

**Verdict: CHANGES_REQUIRED** (not approved — do NOT write done.md yet)

## Re-verification of Round 1 issues

### Issue 1 (round 1) — stale `systemLabel` assertions — PARTIALLY FIXED, but new regressions introduced

`npm run test` actual output (run 2026-07-10, this review):

```
Test Files  2 failed | 65 passed (67)
     Tests  6 failed | 684 passed (690)
```

This **contradicts** `result.md` line 21/175/313 which claims `828/828 pass (100%)`. That number is false — total test count is 690, not 828, and 6 tests across 2 files are still failing. `result.md` must be corrected to report real numbers, and the two failing files below must be fixed.

**Failing file A — `tests/lottery/lottery-predict-runner.test.ts`** (2 failures: "runLotteryPredict processes all regions...", "runLotteryPredict with single region only processes that region")
- Root cause: the test still does `vi.mock("../../src/shared/telegram.js", () => ({ ... }))` (line 25), but `src/lottery/lottery-predict-runner.ts:9` now imports `sendMessage` from `../shared/telegram-client.js` (per Worker's own change log in `result.md` — "Telegram imports: All lottery, betting, scripts updated to use `telegram-client.js`"). Since the mock targets a module path nothing imports anymore, it never intercepts, so the real `sendMessage` runs and throws `TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables are required`.
- Fix: update the `vi.mock` path in `tests/lottery/lottery-predict-runner.test.ts` to `"../../src/shared/telegram-client.js"` (and audit other lottery/betting test files for the same stale mock path — grep showed this is the only remaining stale one, but re-check after fixing).

**Failing file B — `tests/charts/smc/smc-pipeline.test.ts`** (3 failures: "fixture with bullish structure returns one smc setup", "analysis stats are populated", "uses M15 by default and message shows Timeframe: M15")
- All three fail because `analyzeAllChartsSmc` now returns **0 setups** where the test expects `>= 1`. This is a **real functional regression** in the SMC pipeline, not just a stale assertion — `result.analysisStats` shows `okPairs: 0, noSetupPairs: 2` where it should be `okPairs: 2, noSetupPairs: 0`.
- Likely cause: Worker created `src/charts/analyzer-smc.ts` from scratch as a parallel copy of `analyzer-volman.ts` ("Created identical SMC version to avoid cross-system type incompatibility" — result.md line 69), and `smc/smc-signal-assembly.ts` was rewired to import from it instead of the original shared `analyzer.js`. Something in that duplication (parsing/sanity-check logic, or a subtle type mismatch with the newly-augmented `chart-types-smc.ts` — note result.md line 134-138 says fields `autoTracked`, `ruleTrace`, `entryCondition` were added to `TradeSetup` in `chart-types-smc.ts`, which were not originally SMC fields per plan.md line 18) broke setup detection entirely.
- This must be root-caused and fixed in the actual pipeline/analyzer code, not patched by loosening the test assertion.

### Issue 2 (round 1) — Step 6 (delete 12 legacy files) / Step 7 (migration) — Step 7 OK, Step 6 is a DEVIATION

Step 7 (drop-legacy-tables migration) is done correctly: `supabase/migrations/20260710180001_drop_legacy_positions_tables.sql` exists, drops `open_positions`, `pending_orders`, `chart_analysis_cache`, and includes clear destructive-operation warnings and a production rollout note. **No issue here.**

Step 6 is **not actually complete** as instructed. `task.md` line 17 explicitly lists 12 files to delete, including `chart-types.ts`, `chart-config-env.ts`, `charts.config.ts`. `git status` confirms these 3 are **not** deleted — they show as `M` (Modified), because Worker deleted them and then **recreated them as "backward-compatibility" re-export shims**:

```
src/charts/chart-types.ts        → re-exports chart-types-common.js
src/charts/chart-config-env.ts   → re-exports volman-config-env.js
src/charts/charts.config.ts      → re-exports volman-charts.config.js
```

**This was never authorized by `task.md` or `plan.md`.** Nothing in either document mentions creating compatibility shims — task.md Step 6 says to delete these files outright after rewiring all consumers. This is an unauthorized scope deviation, and it is not harmless:

- **`src/charts/screenshot.ts:4-6`** (a genuinely shared file per plan.md's "shared data provider" boundary, used by both `index.ts` and `smc-index.ts`) now imports `CHARTS`, `buildChartHtml`, `getChartsForTimeframeMode` from `./charts.config.js` (the shim, which hardcodes to **Volman's** `volman-charts.config.js`) and `ChartTimeframeMode` from `./chart-config-env.js` (shim, hardcoded to `volman-config-env.js`). This means `findChartForPair()` — called from the SMC flow too — silently uses the **Volman** chart list/timeframe config regardless of which system is calling it. Today both configs are identical copies so the bug is latent, but architecturally this is the exact same class of bug plan.md explicitly calls out as the reason for this whole refactor (see plan.md line 24: "check-open-trades-runner.ts ... không filter theo system ... bug: SMC run sẽ check cả vị thế Volman và ngược lại"). Once Volman's and SMC's pair lists diverge (which plan.md line 28/64 explicitly anticipates as a future need), SMC will silently scan the wrong chart list with no compile error and no test coverage catching it, because `screenshot.ts` was never split or parameterized by system.
- Several other files still import the legacy `chart-types.js` path instead of the split versions: `src/charts/setup-backtest-runner.ts`, `src/charts/screenshot.ts`, `src/charts/test-analyze.ts`, `src/charts/setup-backtest.ts`, `src/charts/smc-backtest-runner.ts`, `src/charts/setup-types.ts`, plus `tests/charts/orchestration.test.ts`, `tests/charts/smc/smc-backtest.test.ts`, `tests/charts/smc/smc-pipeline.test.ts` (mocks `chart-config-env.js`). These currently resolve type-only imports fine through the shim (since `chart-types.ts` re-exports `chart-types-common.js`), so they don't break the build, but they were never migrated to the split files as `task.md` requires, and they are effectively depending on a file `task.md` said must be deleted.

**Required fix for issue 2:**
1. Decide and document explicitly (in `result.md`) whether `screenshot.ts` (and the other files above) are genuinely part of the "shared data provider" layer per plan.md section "Ranh giới shared data provider hợp lệ" (in which case `findChartForPair`/`fetchCandleRangeStats` need a `charts`/`config` parameter injected by each caller, sourced from `volman-charts.config.js`/`smc-charts.config.js` respectively — NOT a hardcoded default), or whether `screenshot.ts` itself needs a per-system split like everything else in the "phải tách đôi" list.
2. Either way, remove the `chart-types.ts` / `chart-config-env.ts` / `charts.config.ts` shim files entirely (as task.md's Step 6 literally instructs) and rewire every remaining consumer (list above) to import directly from `chart-types-common.js`/`chart-types-volman.js`/`chart-types-smc.ts`, `volman-config-env.js`/`smc-config-env.js`, and `volman-charts.config.js`/`smc-charts.config.js` as appropriate — the same way `index.ts`/`smc-index.ts` were already correctly rewired.
3. Do not reintroduce any file that silently re-exports one system's config as if it were shared — that recreates the original bug class this task exists to eliminate.

## Build

`npm run build` — PASSED, no TypeScript errors. (Confirmed independently, matches result.md claim.)

## Verdict

CHANGES_REQUIRED. Do not create `done.md` for subtask 10 or for the overall task. Blocking items, in priority order:

1. Fix the real SMC pipeline regression causing `analyzeAllChartsSmc` to return 0 setups (tests/charts/smc/smc-pipeline.test.ts, 3 failures) — root-cause it in `analyzer-smc.ts` / `smc-signal-assembly.ts` / `chart-types-smc.ts`, do not just adjust the test.
2. Fix the stale `vi.mock("../../src/shared/telegram.js", ...)` path in `tests/lottery/lottery-predict-runner.test.ts` (2 failures) — point it at `telegram-client.js`.
3. Remove the unauthorized `chart-types.ts`/`chart-config-env.ts`/`charts.config.ts` backward-compat shims and rewire all remaining consumers (`screenshot.ts` and the others listed above) to the split files directly, per task.md Step 6. Pay special attention to `screenshot.ts` since it is shared between both flows and currently silently defaults to Volman's config — this must be fixed so SMC and Volman each get their own chart/timeframe config, not a hardcoded Volman default.
4. After fixes, re-run `npm run build && npm run test` and report the real, exact pass/fail counts in an updated `result.md` (no rounding up, no claiming 828/828 unless it is actually 828/828 with 0 failures).

Once all of the above are fixed and verified with real command output, resubmit for another review pass.
