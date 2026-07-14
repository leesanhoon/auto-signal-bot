# Plan: Update Binance Futures symbol list in chart_symbols_volman

## Overview
`chart_symbols_volman` (Supabase table) drives which symbols the bot renders
charts for and can trade (`src/charts/chart-symbols-repository-volman.ts` →
`loadActiveChartSymbols()` → `volman-charts.config.ts:getCharts()`). A live
comparison against Binance USDT-M Futures `exchangeInfo` found:

- **17 active DB symbols are now `SETTLING`** on Binance Futures (contract
  being closed out, no new orders accepted) — they must be deactivated or the
  bot will keep charting/trying to trade dead markets.
- **429 USDT-M Perpetual symbols are `TRADING` on Binance but missing from the
  DB.** User (via AskUserQuestion) chose NOT to bulk-import all 429 — most are
  low-cap/new listings with volume spikes from listing hype. User approved a
  curated shortlist of 9 well-known, high-liquidity symbols instead.
- The static seed source `src/scripts/seed-chart-symbols.ts` still lists
  `PEPEUSDT` and `BONKUSDT` (no `1000` prefix). Binance renamed/redenominated
  these to `1000PEPEUSDT` / `1000BONKUSDT` — the old tickers don't exist in
  `exchangeInfo` at all, so those seed rows were silently dropped by the
  seed script's exchangeInfo validation and were never actually in the DB.
  Two of the 9 approved additions are the corrected `1000PEPEUSDT` /
  `1000BONKUSDT` forms.

## Data (verified via live `GET https://fapi.binance.com/fapi/v1/exchangeInfo`
on 2026-07-14, cross-checked per-symbol individually)

### Remove — status SETTLING on Binance Futures (deactivate, don't hard-delete)
No FK references chart_symbols_volman (verified), so this is a pure data
update. Use `is_active = false` (existing soft-delete pattern via the
indexed `is_active` column), not `DELETE`, so history/audit stays intact
and the change is trivially reversible.

| id  | symbol                  |
|-----|--------------------------|
| 82  | BINANCE:AGIXUSDT         |
| 112 | BINANCE:ALPACAUSDT       |
| 109 | BINANCE:BAKEUSDT         |
| 116 | BINANCE:BNXUSDT          |
| 84  | BINANCE:DENTUSDT         |
| 93  | BINANCE:FXSUSDT          |
| 71  | BINANCE:GLMRUSDT         |
| 103 | BINANCE:IDEXUSDT         |
| 70  | BINANCE:KLAYUSDT         |
| 114 | BINANCE:LINAUSDT         |
| 113 | BINANCE:MBOXUSDT         |
| 73  | BINANCE:MKRUSDT          |
| 83  | BINANCE:OCEANUSDT        |
| 78  | BINANCE:PERPUSDT         |
| 97  | BINANCE:RDNTUSDT         |
| 98  | BINANCE:STRAXUSDT        |
| 110 | BINANCE:VOXELUSDT        |

### Add — TRADING on Binance Futures, high liquidity, user-approved shortlist
Insert into `chart_symbols_volman` with `category = 'crypto'`,
`is_active = true`. `name` follows the existing `TICKER/USDT` convention.

| name           | symbol                  | note |
|----------------|--------------------------|------|
| XMR/USDT       | BINANCE:XMRUSDT          | Monero, established large-cap, was missing entirely |
| PEPE/USDT      | BINANCE:1000PEPEUSDT     | corrects stale seed ticker `PEPEUSDT` (doesn't exist) |
| SHIB/USDT      | BINANCE:1000SHIBUSDT     | new |
| BONK/USDT      | BINANCE:1000BONKUSDT     | corrects stale seed ticker `BONKUSDT` (doesn't exist) |
| JUP/USDT       | BINANCE:JUPUSDT          | new |
| HYPE/USDT      | BINANCE:HYPEUSDT         | new |
| TRUMP/USDT     | BINANCE:TRUMPUSDT        | new |
| KAITO/USDT     | BINANCE:KAITOUSDT        | new |
| XAUT/USDT      | BINANCE:XAUTUSDT         | new |

## File Changes
- `chart_symbols_volman` table (Supabase, project `irgworcpfyfuigyvylkj`) — data-only migration, no schema change.
- `src/scripts/seed-chart-symbols.ts` — keep the source-of-truth seed array in
  sync: remove the 17 delisted `SeedSymbol` entries, fix `PEPEUSDT` →
  `1000PEPEUSDT` and `BONKUSDT` → `1000BONKUSDT`, add the 7 remaining new
  entries (`XMR`, `SHIB`, `JUP`, `HYPE`, `TRUMP`, `KAITO`, `XAUT`).

## Testing Strategy
- Run `npx tsx src/scripts/verify-chart-symbols.ts` (or equivalent existing
  verify script) after the DB update to confirm every `is_active = true`
  crypto symbol in `chart_symbols_volman` resolves against a live Binance
  Futures `exchangeInfo` lookup with `status = TRADING`.
- Manually re-run the SQL diff query from this plan against
  `chart_symbols_volman` post-change to confirm 0 SETTLING symbols remain
  active and the 9 new symbols are present and active.
- `npm run build` must still pass (seed script is TypeScript, must compile).

## Subtasks
| Subtask ID | Description | Owner | Files to Modify | Dependencies | Expected Output |
|------------|-------------|-------|-----------------|--------------|-----------------|
| 01-update-chart-symbols | Deactivate 17 SETTLING symbols, insert 9 approved new symbols in `chart_symbols_volman` via SQL, and sync `src/scripts/seed-chart-symbols.ts` to match | worker | `src/scripts/seed-chart-symbols.ts`, Supabase table `chart_symbols_volman` (project `irgworcpfyfuigyvylkj`) | None | DB updated + seed file in sync + verify script passes |
