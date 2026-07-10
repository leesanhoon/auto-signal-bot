# Review Round 4 — Subtask 10: Rewire Entrypoints & Cleanup

**Date:** 2026-07-10
**Verdict:** CHANGES_REQUIRED (one small remaining issue)

## Build / Test — verified by Lead directly (not trusting result.md)

- `npm run build` → PASS, no TypeScript errors.
- `npm run test` → **690/690 tests passing, 67/67 test files passing.**
  - `tests/charts/orchestration.test.ts` now imports `../../src/charts/volman-config-env.js` (line 14, 22) instead of the deleted `chart-config-env.js`. PASS.
  - `tests/charts/screenshot.test.ts` now calls `screenshot.captureChartScreenshot({...}, buildChartHtmlMock)` with the `buildChartHtmlFn` passed as a second argument (line 57-64), matching the new signature of `captureChartScreenshot` in `src/charts/screenshot.ts` after config split. PASS. Confirmed via `npx vitest run tests/charts/screenshot.test.ts` and full suite run — no failures.

Both of the two previously-failing test files from round 3 are now fixed correctly and are NOT deviating from plan/task scope (pure import/signature fix, no logic change).

## Sanity sweep for dangling references to deleted legacy files

Checked all 12 deleted files: `chart-types.ts`, `chart-config-env.ts`, `charts.config.ts`, `analyzer.ts`, `chart-cache-repository.ts`, `check-open-trades-runner.ts`, `check-pending-orders-runner.ts`, `performance-report-runner.ts`, `performance-tracking.ts`, `position-decision.ts`, `position-engine.ts`, `positions-repository.ts`, `src/shared/telegram.ts`.

Confirmed all 12 files are physically deleted (no re-export shims left behind — this matches the fix from round 2/3).

### Found: 1 dangling reference not caught by `npm run build`

`tests/charts/smc/smc-backtest.test.ts:3`
```ts
import type { ChartTimeframe } from "../../../src/charts/chart-types.js";
```

This file (`src/charts/chart-types.ts`) was deleted in Step 6. The reference still resolves to nothing on disk. It does **not** cause a build or test failure because:
- `tsconfig.json` only has `"include": ["src/**/*"]` — test files under `tests/` are never type-checked by `npm run build` (tsc), so this broken import is invisible to the build step.
- At the `import type` is a type-only import, which esbuild/vite strips at transform time before the module resolver ever tries to load it at runtime, so `npx vitest run` also does not fail on it.

This is exactly the kind of "not caught by TypeScript, dangling import to a deleted file" case flagged in the review brief. It is real dead code / an inconsistent reference and must be fixed for full cleanup, even though it does not currently break CI.

**Required fix:** In `tests/charts/smc/smc-backtest.test.ts:3`, change
```ts
import type { ChartTimeframe } from "../../../src/charts/chart-types.js";
```
to
```ts
import type { ChartTimeframe } from "../../../src/charts/chart-types-smc.js";
```
(or `chart-types-common.js` if `ChartTimeframe` lives there — verify with `grep -n "ChartTimeframe" src/charts/chart-types-smc.ts src/charts/chart-types-common.ts` before editing, since this test is under `tests/charts/smc/` and should align with the SMC split).

After the fix, re-run `npm run build && npm run test` and confirm 690/690 still pass, then re-grep for any remaining reference to `chart-types.js`, `chart-config-env.js`, `charts.config.js` (bare, not `-volman`/`-smc` suffixed) under both `src/` and `tests/` to confirm zero matches.

## Other checks performed (all clean)

- Commented-out (`// import ...`) references to `./check-pending-orders-runner.js` in `src/charts/index.ts:4` and `src/charts/smc-index.ts:4` are pre-existing dead comments from the earlier `disable-pending-orders` task, not active imports — not in scope for this task, not a regression, left as-is intentionally per that task's own scope.
- No other bare (non-suffixed) references to any of the 12 deleted files found anywhere in `src/` or `tests/` via `.js` import-path grep.
- `docs/` grep for the 12 deleted filenames returned no matches.
- Migration file `supabase/migrations/20260710180001_drop_legacy_positions_tables.sql` exists per Step 7, with destructive-operation warning as required by task.md.

## Verdict

CHANGES_REQUIRED — single one-line fix needed in `tests/charts/smc/smc-backtest.test.ts:3`. Everything else (build, full test suite, entrypoint rewiring, file deletions, migration) is confirmed correct and matches plan.md / task.md. This should be the last remaining item before final approval.
