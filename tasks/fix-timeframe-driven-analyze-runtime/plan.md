# Plan - Make analyze runtime and CI follow configured timeframe close

## Context

Review workflow va runtime hien tai cho thay 2 lop config chua dong bo voi muc tieu "phan tich theo nen da dong cua timeframe da cau hinh":

1. CI `analyze` da duoc wire de nhan:
   - `CHART_ENGINE_MODE`
   - `CHART_TIMEFRAME_MODE`
   - `CHART_PRIMARY_TIMEFRAME`

   nhung lich cron trong `.github/workflows/analyze.yml` van hardcode:

   - `5 0,4,8,12,16,20 * * 1-5`

   tuc la cadence H4, khong phu thuoc timeframe config.

2. Runtime chart scanner van hardcode H4 close window trong:
   - `src/charts/chart-cache.ts`
   - `src/charts/index.ts`

   Cu the:
   - `getCurrentH4CandleCloseKey()`
   - `isWithinCandleCloseWindow(...)`
   - log message va skip behavior deu noi ve H4

He qua:

- du cau hinh `single + M15`, system van neo theo H4
- CI khong chay theo nhịp dong nen cua timeframe da cau hinh
- cache key / close window / scheduling semantics chua dung voi intent moi

## Muc tieu

- Scanner phan tich dua tren nen DA DONG cua timeframe runtime duoc cau hinh.
- CI `analyze` chay theo cadence phu hop voi timeframe da cau hinh.
- Runtime close-key / close-window / cache identity phai timeframe-aware, khong hardcode H4 nua.

## Scope can lam ro

Vi GitHub Actions `schedule` la static YAML, no khong the tu dong doi cron dua tren `vars` luc runtime.
Vi vay worker can chon 1 phuong an ky thuat phu hop va ghi ro tradeoff:

1. Hoac doi workflow thanh cadence "day du hon" (vd moi 15 phut) va de runtime tu quyet dinh co dang dung close window cua timeframe cau hinh hay khong.
2. Hoac tach workflows / cron theo timeframe profile ro rang.

Uu tien phuong an 1 neu no giu workflow don gian va phu hop yeu cau "CI se chay theo timeframe da cau hinh neu cau hinh theo thoi gian dong nen".

## Contract mong muon

1. `single + M15`
   - cadence CI phai cho phep scanner chay sau moi lan nen M15 dong
   - runtime chi phan tich tren nen M15 da dong, khong dung nen dang hinh thanh

2. `single + H4`
   - behavior tuong duong H4 hien tai, nhung thong qua abstraction timeframe-aware

3. `single + D1`
   - cadence/runtime phai dua theo daily close da chon

4. `multi`
   - worker can chot ro "primary close timeframe" dung de trigger run/cache/window la gi
   - neu giu legacy semantics, can document ro rang

## Subtasks

| ID | Subtask | Muc tieu |
| --- | --- | --- |
| 01 | `01-design-timeframe-close-contract/` | Chot contract runtime + CI cadence cho single/multi, nen da dong, cache key, close window |
| 02 | `02-implement-timeframe-aware-close-window/` | Sua runtime chart cache/index de tinh close key + close window theo timeframe cau hinh |
| 03 | `03-update-analyze-workflow-cadence/` | Sua workflow analyze de cadence phu hop timeframe intent va khong con neo cung vao H4 |
| 04 | `04-add-tests-and-docs/` | Them test regression va cap nhat docs/env comments cho semantics moi |

## Verification

```bash
npm run build
npm run test -- --run
```

Neu co script/kiem tra tay, ghi ro trong ket qua:

- timeframe nao da duoc verify
- close key/window moi tinh ra sao
- CI cadence moi la gi va vi sao
