# Review Summary - fix-arb-edge-semantics

## Status

CHANGES_REQUIRED

## Findings

### 1. Edge-test detector still counts closes outside the range as valid "closed back inside" failures

- Files:
  - `src/charts/setups/arb.ts:67-75`
  - `tests/charts/setups.test.ts:231-308`
- Severity: High

The new same-edge conditions fixed the breakout side, but they still do not enforce the "closed back inside" part of the contract.

Current logic:

- `LONG`: `candle.high > levelHigh && candle.close <= levelHigh`
- `SHORT`: `candle.low < levelLow && candle.close >= levelLow`

This means a candle can probe one boundary and then close completely through the opposite side of the range and still be counted as a valid failed edge test. For example, a `LONG` ARB now accepts a candle whose `high` spikes above `range.high` but whose `close` finishes **below `range.low`**. That is not a rejection back inside the range; it is a full-range reversal / breakout through the opposite edge.

Please tighten the conditions so failed edge tests only count when the close returns **inside the range**:

- `LONG`: close should be `>= levelLow && <= levelHigh`
- `SHORT`: close should be `>= levelLow && <= levelHigh`

The updated ARB tests only cover mild rejections that close near the tested edge, so they do not catch this remaining false-positive path. Add or adjust regression coverage to prove that a candle closing beyond the opposite boundary does **not** count as an edge test.
