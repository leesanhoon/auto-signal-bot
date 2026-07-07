# Plan - Fix ARB edge-test semantics after review

## Context

Task `investigate-arb-edge-test-scope` da mo rong pham vi quet edge-test cua
ARB tu `range.startIndex` sang `testLookback`, nhung review sau do phat hien
mot van de correctness nghiem trong hon:

- `detectArb` mo ta ARB la dem cac failed edge test o **cung phia voi huong
  breakout that** ("false breaks at the same edge").
- Tuy nhien code hien tai lai dem:
  - `LONG`: `candle.high > levelLow && candle.close <= levelLow`
  - `SHORT`: `candle.low < levelHigh && candle.close >= levelHigh`
- Nghia la detector dang tinh cac failed move o **canh doi dien** cua range,
  khong phai failed test o canh breakout.

Regression test moi trong `tests/charts/setups.test.ts` cung dang dung fixture
`LONG` co 2 lan quet xuong duoi day range roi dong lai, nen no vo tinh khoa
hanh vi sai nay vao suite thay vi chung minh "same-edge failed tests before a
real breakout".

Can co mot vong fix rieng de worker sua dung semantics ARB va cap nhat
coverage theo review finding, khong mo rong scope sang threshold/heuristic khac.

## 1 subtask

- `01-fix-arb-edge-semantics/`

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts
```

Lead se tu review lai diff va quyet dinh co can chay full suite / backtest them
hay khong.
