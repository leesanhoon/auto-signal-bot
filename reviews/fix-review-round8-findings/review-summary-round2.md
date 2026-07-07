# Review Summary Round 2 - fix-review-round8-findings

## Status

CHANGES_REQUIRED

## Findings

### 1. `single D1` da bo luon volatility gate, khong dung voi contract da mo ta (MEDIUM)

Ban fix truoc da dung huong khi tach daily chart khoi session-hour gate intraday.
Tuy nhien implementation hien tai trong `src/charts/deterministic-pipeline.ts`:

- chi can `atrLast` va `atrAvg20d` khac `null`
- neu timeframe la `D1` thi `return true` ngay

He qua:

- `single D1` khong con session gate intraday, dieu nay dung
- nhung dong thoi cung khong con volatility floor nua
- khac voi contract da ghi trong `result.md`: "van giu volatility check qua ATR, nhung khong bi loai chi vi candle time nam ngoai khung 13:00-21:00 UTC"

## Yeu cau fix

1. Chot 1 contract ro rang cho `D1` va sua code theo dung contract do.

2. Neu giu theo contract da ghi trong `result.md`, thi:
   - `D1` phai bo session-hour gate intraday
   - nhung van phai giu volatility check:
     - khong duoc `return true` vo dieu kien cho `D1`
     - van can check logic tuong duong `atr14Now >= 0.3 * atr14Avg20d`

3. Neu team muon bo ca volatility gate cho `D1`, thi can:
   - sua lai contract/tai lieu/task result cho trung thuc
   - them test xac nhan y do
   - nhung uu tien hien tai la sua theo contract da ghi san, de tranh doi semantics them nua

## Test bat buoc

Bo sung test regression cho `D1`:

1. case timestamp daily nam ngoai `13:00-21:00 UTC` nhung volatility hop le
   - pipeline van duoc xu ly

2. case `atrLast` thap hon volatility floor
   - `D1` van bi skip

Test hien tai moi chi bat duoc viec fetch `D1`, chua bat duoc contract "bo session gate nhung giu volatility gate".

## Verification

```bash
npm run build
npm run test -- --run
```
