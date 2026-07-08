# Task 03 - Thay AI open/pending trade management bang rule OHLC

## Muc tieu

Bo OpenRouter khoi open-position review va pending-order review.

## File du kien can sua

- `src/charts/check-open-trades-runner.ts`
- `src/charts/check-pending-orders-runner.ts`
- `src/charts/position-decision.ts`
- `src/charts/analyzer.ts` neu dang chua pending prompt/parser
- `src/charts/positions-repository.ts` neu can them metadata
- tests lien quan

## Rule policy de xuat

### Open positions

- Neu SL cham: `STOP`
- Neu TP2 cham: `CLOSE` + `TP2_CLOSE`
- Neu TP1 cham lan dau: `HOLD` + `PARTIAL_TP1` + move SL ve entry
- Neu da partial va co rule trailing: cap nhat trailing theo configured policy
- Neu khong co event gia: `HOLD` voi comment "Chua cham SL/TP theo du lieu OHLC"
- Neu khong lay duoc OHLC: `HOLD` va log warning, khong goi AI

### Pending orders

- BUY_STOP/SELL_STOP/BUY_LIMIT/SELL_LIMIT: trigger/cancel theo high/low/SL/entry
- `WAIT_FOR_CONFIRMATION`: can chot policy deterministic:
  - option de xuat: giu pending toi expiry, cancel neu gia cham SL invalidation
- Qua `expiryRuns`: `EXPIRED`
- Neu khong lay duoc OHLC: tang run count, giu `PENDING` hoac expire theo rule

## Yeu cau

1. Xoa import/call OpenRouter khoi runners.
2. Neu `position-decision.ts` khong con dung, xoa hoac doi thanh helper rule-based.
3. Khong chup screenshot chi de review AI.
4. Telegram notification phai giai thich decision theo gia/OHLC.

## Verification

```bash
npm run test -- --run tests/charts/check-open-trades-runner.test.ts tests/charts/check-pending-orders-runner.test.ts tests/charts/position-decision.test.ts
npm run build
rg -n "callOpenRouter|OpenRouter|AI_PENDING_MODEL|position decision temporary error|Pending order AI" src/charts tests/charts
```
