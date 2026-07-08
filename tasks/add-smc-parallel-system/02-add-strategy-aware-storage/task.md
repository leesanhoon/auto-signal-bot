# Task 02 - Them strategy-aware storage cho open positions, pending orders, cache va reporting

## Muc tieu

Sua data model de he thong co the luu song song signal/lenh cua `volman` va `smc` ma khong xung dot.

## File du kien can sua

- `src/charts/chart-types.ts`
- `src/charts/positions-repository.ts`
- `src/charts/chart-cache-repository.ts`
- `src/charts/analyzer.ts` hoac helper build cache key lien quan
- `src/charts/performance-tracking.ts`
- `supabase/migrations/...` (tao migration moi, khong sua migration cu da deploy)
- Cac test lien quan

## Yeu cau

1. Them metadata strategy vao model
   - `strategyKey` toi thieu tren `TradeSetup`
   - neu can thi them tren `PairSummary`, `PendingOrder`, `OpenPosition`

2. DB migration moi
   - them cot `strategy_key` cho bang can thiet
   - backfill gia tri mac dinh cho du lieu cu la `volman`
   - them index/unique constraint hop ly theo `pair + strategy_key + status`

3. Repository logic
   - `saveOpenPosition()` khong dupe sai giua 2 strategy
   - `savePendingOrder()` khong dupe sai giua 2 strategy
   - query/load/update can map du `strategyKey`

4. Cache key
   - phan biet theo strategy, engine mode, timeframe mode

5. Reporting/performance
   - khong tron thong ke Volman va SMC neu code hien tai co tong hop closed positions

## Dau ra mong muon trong `result.md`

- migration nao da tao
- field nao da them
- logic dedupe moi hoat dong the nao
- test nao da them/chay

## Khong lam

- Chua implement detector SMC
- Chua doi full orchestration runtime neu khong can cho storage task

## Verification

```bash
npm run test -- --run
npm run build
```
