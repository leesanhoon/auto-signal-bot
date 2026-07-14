# Task: Update chart_symbols_volman for delisted/new Binance Futures symbols

## Context (self-contained — do not need to re-derive anything)

`src/scripts/seed-chart-symbols.ts` holds a `SEED_DATA` array that is the
source of truth for the `chart_symbols_volman` Supabase table. Running the
script upserts every row into the DB (`onConflict: "symbol"`), and for
`BINANCE:` symbols it validates each one against the **live** Binance Futures
`GET /fapi/v1/exchangeInfo` before insert (rows that fail the lookup are
skipped and logged — see `main()` in that file, lines ~229-284).

**Important limitation you must know**: that validation only checks whether
the symbol exists in `exchangeInfo` at all — it does NOT check the `status`
field. A symbol whose Binance status is `SETTLING` (contract being closed
out, no new orders) still passes the validation. So simply re-running the
seed script will NOT deactivate the 17 symbols below — you must explicitly
set `active: false` on their `SEED_DATA` entries yourself.

A live diff against Binance Futures `exchangeInfo` (done 2026-07-14) found:
- 17 symbols currently `active: true` in `SEED_DATA` (and `is_active=true` in
  the DB) now have Binance status `SETTLING`.
- 3 existing `SEED_DATA` entries (`PEPEUSDT`, `BONKUSDT`, `SHIBUSDT`) use
  stale ticker names — Binance renamed/redenominated these to
  `1000PEPEUSDT`, `1000BONKUSDT`, `1000SHIBUSDT`. The old names don't exist
  in `exchangeInfo` at all, so these three rows have always been silently
  skipped by the seed script and were never actually present in the DB.
- 6 new symbols (high-liquidity, user-approved) should be added.

Do not touch any other `SEED_DATA` entries. Do not investigate or "fix"
other possibly-stale tickers you notice while editing (e.g. `MATICUSDT`,
`LOOKSUSDT`) — out of scope for this task.

## Step 1 — Edit `src/scripts/seed-chart-symbols.ts`

Open the file and locate the `SEED_DATA` array (starts at the line with
`const SEED_DATA: SeedSymbol[] = [`).

### 1a. Set `active: false` on these 17 existing entries

Find each line by its `symbol` value below and change `active: true` to
`active: false` on that line ONLY. Do not change `name` or `symbol` on these
17 lines.

- `BINANCE:AGIXUSDT`
- `BINANCE:ALPACAUSDT`
- `BINANCE:BAKEUSDT`
- `BINANCE:BNXUSDT`
- `BINANCE:DENTUSDT`
- `BINANCE:FXSUSDT`
- `BINANCE:GLMRUSDT`
- `BINANCE:IDEXUSDT`
- `BINANCE:KLAYUSDT`
- `BINANCE:LINAUSDT`
- `BINANCE:MBOXUSDT`
- `BINANCE:MKRUSDT`
- `BINANCE:OCEANUSDT`
- `BINANCE:PERPUSDT`
- `BINANCE:RDNTUSDT`
- `BINANCE:STRAXUSDT`
- `BINANCE:VOXELUSDT`

Example of the edit for one of them (same pattern for all 17):
```
// before
{ name: "AGIX/USDT", symbol: "BINANCE:AGIXUSDT", category: "crypto", active: true },
// after
{ name: "AGIX/USDT", symbol: "BINANCE:AGIXUSDT", category: "crypto", active: false },
```

### 1b. Fix 3 stale ticker names (symbol field only, keep `active: true`)

```
// before
{ name: "PEPE/USDT", symbol: "BINANCE:PEPEUSDT", category: "crypto", active: true },
// after
{ name: "PEPE/USDT", symbol: "BINANCE:1000PEPEUSDT", category: "crypto", active: true },
```

```
// before
{ name: "BONK/USDT", symbol: "BINANCE:BONKUSDT", category: "crypto", active: true },
// after
{ name: "BONK/USDT", symbol: "BINANCE:1000BONKUSDT", category: "crypto", active: true },
```

```
// before
{ name: "SHIB/USDT", symbol: "BINANCE:SHIBUSDT", category: "crypto", active: true },
// after
{ name: "SHIB/USDT", symbol: "BINANCE:1000SHIBUSDT", category: "crypto", active: true },
```

### 1c. Add 6 new entries

Add these 6 new lines anywhere inside the crypto section of `SEED_DATA`
(e.g. right after the `BTC/USDT` line, or at the end of the crypto block
just before the blank line preceding `XAU/USD`). Keep them together as a
block:

```typescript
  { name: "XMR/USDT", symbol: "BINANCE:XMRUSDT", category: "crypto", active: true },
  { name: "JUP/USDT", symbol: "BINANCE:JUPUSDT", category: "crypto", active: true },
  { name: "HYPE/USDT", symbol: "BINANCE:HYPEUSDT", category: "crypto", active: true },
  { name: "TRUMP/USDT", symbol: "BINANCE:TRUMPUSDT", category: "crypto", active: true },
  { name: "KAITO/USDT", symbol: "BINANCE:KAITOUSDT", category: "crypto", active: true },
  { name: "XAUT/USDT", symbol: "BINANCE:XAUTUSDT", category: "crypto", active: true },
```

(Note: `PEPE/USDT`, `BONK/USDT`, `SHIB/USDT` are NOT new lines — they were
already fixed in step 1b. Do not duplicate them.)

## Step 2 — Run the seed script to apply to the DB

```bash
npx tsx src/scripts/seed-chart-symbols.ts
```

This upserts every `SEED_DATA` row into Supabase table `chart_symbols_volman`
(project ref `irgworcpfyfuigyvylkj`). Requires the project's normal env vars
to already be configured (same as any other script run in this repo — see
`src/shared/env.js` import at the top of the seed script). If the script
fails because env vars / Supabase credentials are missing, stop and write
`blocked.md` — do not guess credentials.

Read the script's console output carefully:
- It prints how many rows were skipped because they failed live Binance
  Futures `exchangeInfo` validation, with reasons. None of the 17 SETTLING
  symbols or the 9 new/fixed symbols should appear in that skipped list. If
  any of them do appear as skipped, note it in `result.md` — do not try to
  fix it yourself, that means the live Binance data changed since this task
  was written.

## Step 3 — Verify

Run:
```bash
npm run build
```
Must pass with no new TypeScript errors.

Then run this SQL against the Supabase project (project_id
`irgworcpfyfuigyvylkj`) via the Supabase MCP `execute_sql` tool, or via
`npx tsx` with a one-off script using `getDb()` from `src/shared/db.js` if
you don't have MCP access:

```sql
SELECT symbol, is_active FROM public.chart_symbols_volman
WHERE symbol IN (
  'BINANCE:AGIXUSDT','BINANCE:ALPACAUSDT','BINANCE:BAKEUSDT','BINANCE:BNXUSDT',
  'BINANCE:DENTUSDT','BINANCE:FXSUSDT','BINANCE:GLMRUSDT','BINANCE:IDEXUSDT',
  'BINANCE:KLAYUSDT','BINANCE:LINAUSDT','BINANCE:MBOXUSDT','BINANCE:MKRUSDT',
  'BINANCE:OCEANUSDT','BINANCE:PERPUSDT','BINANCE:RDNTUSDT','BINANCE:STRAXUSDT',
  'BINANCE:VOXELUSDT',
  'BINANCE:1000PEPEUSDT','BINANCE:1000BONKUSDT','BINANCE:1000SHIBUSDT',
  'BINANCE:XMRUSDT','BINANCE:JUPUSDT','BINANCE:HYPEUSDT','BINANCE:TRUMPUSDT',
  'BINANCE:KAITOUSDT','BINANCE:XAUTUSDT'
)
ORDER BY symbol;
```

Expected result: the 17 `SETTLING` symbols show `is_active = false`, and the
9 fixed/new symbols (`1000PEPEUSDT`, `1000BONKUSDT`, `1000SHIBUSDT`,
`XMRUSDT`, `JUPUSDT`, `HYPEUSDT`, `TRUMPUSDT`, `KAITOUSDT`, `XAUTUSDT`) show
`is_active = true`. Paste this query result into `result.md` as evidence.

## Output

Write `tasks/2026-07-14-update-binance-futures-symbols/01-update-chart-symbols/result.md`
summarizing:
- The diff applied to `SEED_DATA` (confirm all 26 line changes made: 17
  deactivations, 3 ticker fixes, 6 new additions)
- Seed script console output (rows upserted, rows skipped + reasons)
- `npm run build` result
- The verification SQL query result (paste the table)

If blocked at any step (missing env vars, seed script errors you can't
resolve, build failures unrelated to your change), write `blocked.md`
instead with the exact error output. Do not guess or work around blockers.
