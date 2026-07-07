# Review Summary - fix-review-round8-findings

## Status

CHANGES_REQUIRED

## Findings

### 1. `single D1` deterministic mode van bi session filter intraday loai sai (HIGH)

Worker da sua de deterministic engine fetch dung runtime timeframe khi `timeframeMode = "single"`.
Tuy nhien, voi `primaryTimeframe = "D1"`, pipeline van ap dung session filter intraday:

- `src/charts/deterministic-pipeline.ts`
  - `analysisTimeframe` co the la `"D1"`
  - nhung sau do van goi `isTradableWindow(lastCandle.time, atrLast, atrAvg20d)`

- `src/charts/indicators.ts`
  - `isTradableWindow(...)` hardcode quy tac London/NY overlap `13:00-21:00 UTC`

He qua:

- `single` + `D1` khong thuc su chay duoc theo nghia daily analysis
- daily candle se bi skip boi mot filter chi hop le cho intraday
- behavior runtime van sai du worker da wire timeframe xuong pipeline

## Yeu cau fix

1. Trong deterministic pipeline, tach ro session/volatility filter theo timeframe:
   - voi timeframe intraday (`H4`, `M15`) co the giu `isTradableWindow(...)` neu dung voi behavior hien tai
   - voi `D1` khong duoc dung session-hour gate intraday nhu hien nay

2. Chon 1 trong 2 huong, mien nhat quan va co ly do ro:
   - bo qua session-hour filter cho `D1`, chi giu volatility check neu can
   - hoac tao rule timeframe-aware ro rang thay vi goi truc tiep `isTradableWindow(...)` cho moi timeframe

3. Bo sung test regression that su bat duoc bug:
   - test cho `single D1` khong bi skip chi vi hour nam ngoai `13-21 UTC`
   - khong dung fixture daily fake o `14:00 UTC` vi no vo tinh che bug
   - nen dung timestamp daily ngoai overlap, vi du `00:00 UTC` hoac `22:00 UTC`, va assert pipeline van xu ly theo contract mong muon

## Goi y implementation

- Co the them helper moi timeframe-aware trong `src/charts/deterministic-pipeline.ts` hoac `src/charts/indicators.ts`
- Muc tieu la tranh ap dung trading-session gate intraday cho daily chart
- Khong can redesign toan bo deterministic strategy; chi can sua cho `single D1` khong bi loai sai

## Verification

```bash
npm run build
npm run test -- --run
```

Can ghi ro trong ket qua:

- file da sua
- contract moi cho `D1`
- test nao da them/sua de bat regression nay
