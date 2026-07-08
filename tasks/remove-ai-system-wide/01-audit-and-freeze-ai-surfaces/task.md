# Task 01 - Audit va chot pham vi bo AI cho trading + lottery

## Muc tieu

Cap nhat inventory tat ca diem AI trong trading, lottery, shared/env/docs/tests. Chot ro pham vi task nay co bao gom betting hay khong.

## File can doc

- `tasks/remove-ai-from-chart-analysis/01-audit-all-ai-dependencies/result.md`
- `src/charts/index.ts`
- `src/charts/analyzer.ts`
- `src/charts/position-decision.ts`
- `src/charts/check-open-trades-runner.ts`
- `src/charts/check-pending-orders-runner.ts`
- `src/lottery/lottery-ai-predict.ts`
- `src/lottery/lottery-ensemble-predict.ts`
- `src/lottery/lottery-predict-runner.ts`
- `src/lottery/lottery-predict-resync-index.ts`
- `.env.example`
- `README.md`
- `.github/workflows/*.yml`

## Yeu cau dau ra

Ghi `result.md` voi:

1. Danh sach AI call path production cho trading
2. Danh sach AI call path production cho lottery
3. Danh sach shared/env/docs/tests can don
4. Betting co AI hay khong, va de xuat in-scope/out-of-scope
5. Exact remove/replace decision cho tung file

## Khong lam

- Chua sua code runtime o task nay neu khong can.

## Verification

```bash
rg -n "callOpenRouter|OpenRouter|AI_VISION_MODEL|AI_TEXT_MODEL|AI_USAGE|lottery-ai-predict|từ AI|gọi AI|goi AI" src tests .env.example README.md docs .github
```
