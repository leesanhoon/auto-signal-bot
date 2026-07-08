# Task 04 - Chuyen lottery prediction sang algorithm-only ensemble

## Muc tieu

Lottery prediction khong con goi AI. Ensemble chi dung cac predictor thuat toan.

## File du kien can sua

- `src/lottery/lottery-ensemble-predict.ts`
- `src/lottery/lottery-ai-predict.ts`
- `src/lottery/lottery-predict-runner.ts`
- `src/lottery/lottery-predict-resync-index.ts`
- `src/lottery/lottery-predictions-repository.ts` neu can method version
- tests trong `tests/lottery`

## Algorithm de xuat

MVP algorithm-only:

- Stats predictor: frequency + gap + overdue
- Regression predictor: digit position trend
- Recency/cycle predictor moi neu can nang quality:
  - uu tien digit co tan suat gan day tang
  - phat diem nhe cho digit qua lau chua ve
  - penalty cho candidate trung lap qua gan

Weights de xuat:

- stats: 0.45
- regression: 0.40
- recency/cycle: 0.15 neu implement
- neu chua them predictor moi: stats 0.55, regression 0.45

## Yeu cau

1. Bo import va call `predictTopNumbersAI`.
2. Doi `ENSEMBLE_METHOD_VERSION`, vi du `ensemble-algorithm-v1`.
3. Doi `MethodBreakdown` khong con field `ai`.
4. Reason text khong con prefix `AI:`.
5. Runner/log/error message khong con noi "se goi AI" / "AI du doan loi".
6. Test cu mock AI phai xoa/doi thanh algorithm-only.

## Verification

```bash
npm run test -- --run tests/lottery
npm run build
rg -n "lottery-ai-predict|predictTopNumbersAI|breakdown\\.ai|AI dự đoán|gọi AI|goi AI" src/lottery tests/lottery
```
