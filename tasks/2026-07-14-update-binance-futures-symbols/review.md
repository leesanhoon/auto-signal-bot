# Lead Review: 01-update-chart-symbols

## Verdict: APPROVED (with 1 correction to result.md, no code rework needed)

## What I verified independently
- `git diff -- src/scripts/seed-chart-symbols.ts`: exactly the 26 changes
  specified in `task.md` (17 `active: false`, 3 ticker corrections, 6 new
  additions). No scope creep — no other `SEED_DATA` entries touched, no
  other files touched.
- Live query against `chart_symbols_volman` (project `irgworcpfyfuigyvylkj`):
  confirms 17 SETTLING symbols are `is_active=false`, and 8 of the 9
  new/fixed symbols are `is_active=true` and present. Matches `result.md`.
- Re-verified `XAUTUSDT` root cause myself: it does NOT exist in
  `https://testnet.binancefuture.com/fapi/v1/exchangeInfo` (confirmed via
  direct curl), even though it's `TRADING` on production
  `https://fapi.binance.com`. This repo's `.env` has
  `BINANCE_FUTURES_BASE_URL=https://testnet.binancefuture.com` active (prod
  URL is commented out). `getExchangeInfoFilters()` in
  `src/charts/binance-futures-client.ts:142` uses this configured base URL,
  so the seed script's validation ran against **testnet**, not production.
  This is a gap in my own `plan.md`/`task.md` (I verified candidate symbols
  against production only) — not a Worker mistake. Given
  `BINANCE_LIVE_TRADING_ENABLED_VOLMAN` defaults to false and this repo is
  currently wired to testnet for execution, rejecting a symbol that isn't
  tradeable on testnet is actually the *correct* outcome right now — adding
  it would have produced a symbol that charts fine (chart klines come from
  Binance **Spot** production API, unaffected — see
  `src/charts/ohlc-provider.ts:379`) but would fail at order-execution time.
  **No action needed.** If/when `BINANCE_FUTURES_BASE_URL` is switched to
  production for live trading, `XAUTUSDT` can be re-added by rerunning the
  seed script unchanged (it's already in `SEED_DATA` with `active: true`,
  it just didn't get an exchangeInfo match this run).

## Issue found: `result.md` build claim is inaccurate

**File:** `tasks/2026-07-14-update-binance-futures-symbols/01-update-chart-symbols/result.md:76`
**Claim:** "✓ **Result:** Passed. No TypeScript errors."
**Actual:** I reran `npm run build` independently and it currently fails:

```
src/charts/check-open-trades-runner-volman.ts(58,48): error TS2345: ...
src/charts/check-pending-orders-runner-volman.ts(58,45): error TS2345: ...
```

I confirmed via `git stash` (stashing the Worker's `seed-chart-symbols.ts`
change and rebuilding) that **these 2 errors are pre-existing and unrelated
to this task** — they come from commit `40b168f` ("feat: add retry, rate
limit, and error detail to Binance OHLC range stats fetch"), which landed on
`main` separately (repo is now 3 commits ahead of origin, was 2 when I wrote
`task.md`). So the Worker's actual change does not break the build.

**Action:** No rework needed on the seed-symbols task itself — the data
change is correct and isolated. But `result.md`'s "Passed, no errors" line
is factually wrong for the current `main` HEAD and should not be trusted at
face value in future review cycles. Not fixing `result.md` retroactively
(low value); flagging here for the audit trail instead.

## Separate, out-of-scope, pre-existing build break (flagged, not part of this task)
`src/charts/check-open-trades-runner-volman.ts:58` and
`src/charts/check-pending-orders-runner-volman.ts:58` fail to type-check
against `CandleRangeStats | Error` return type introduced by commit
`40b168f`. This currently breaks `npm run build` on `main` for everyone.
Spawning a separate task/session for this — unrelated to symbol curation.

## Approval
`01-update-chart-symbols` subtask is **DONE**. The `chart_symbols_volman`
data change matches `plan.md` and `task.md` exactly, verified independently
against the live DB and both Binance production and testnet APIs.
