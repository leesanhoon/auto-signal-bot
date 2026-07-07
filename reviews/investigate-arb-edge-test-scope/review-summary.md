# Review Summary - investigate-arb-edge-test-scope

## Status

CHANGES_REQUIRED

## Findings

### 1. Regression test validates the wrong edge for a LONG ARB

- Files:
  - `src/charts/setups/arb.ts:67-74`
  - `tests/charts/setups.test.ts:231-279`
- Severity: High

`detectArb` documents and traces ARB as counting failed tests on the breakout edge ("false breaks at the same edge"), but the new regression fixture for a `LONG` breakout only creates candles that probe **below the range low** and close back under/around that low. That means the test is proving acceptance of opposite-edge failures rather than repeated failed upside probes before an upside breakout.

Because the implementation currently counts `LONG` tests with `candle.high > levelLow && candle.close <= levelLow` and `SHORT` tests with `candle.low < levelHigh && candle.close >= levelHigh`, widening the scan to `testLookback` now promotes many opposite-edge moves into ARB qualifications. The new test locks that behavior in instead of checking the intended "same breakout edge" contract.

Please revisit the ARB edge-test definition and update both code and regression coverage so that:

- `LONG` only counts failed tests of the **upper** range boundary.
- `SHORT` only counts failed tests of the **lower** range boundary.
- The pre-range lookback test fixture exercises those same-edge failures explicitly.
