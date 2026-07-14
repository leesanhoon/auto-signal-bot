# Signal Timing Fix — Design Spec

Date: 2026-07-14

## Problem

Telegram signal alerts (Volman strategy) are frequently sent after price has
already moved well past the intended entry level — the entry shown in the
chart no longer reflects a clean, actionable setup. Three screenshots
(XMR/USDT LONG, TRUMP/USDT SHORT, PYTH/USDT SHORT) show entry lines marked far
outside the visible consolidation range, with a diagonal marker jumping to a
stale entry point.

Root causes identified (read-only investigation, no fixes yet):

1. **Detection lookback window** — `deterministic-pipeline.ts` scans for
   triggers up to 5 candles behind the latest closed candle
   (`startDetectIndex = max(30, lastIndex - 5)`), so a signal can be reported
   as "new" even though its trigger candle closed several candles ago.
2. **No intermediate distance-from-entry gate** — the only existing
   freshness check (`signal-freshness.ts`, `analyzer-volman.ts`
   `applyPriceSanityChecks`) rejects a setup only after price has fully
   breached TP1 or SL. A setup where price has already run most of the way to
   TP1 (but not fully hit it) passes through untouched.
3. **Chart never renders live price** — `signal-assembly.ts` slices the
   candle window to `[triggerIndex-60, triggerIndex+2]`, so the rendered
   chart stops shortly after the trigger candle and never shows the current
   candle or a live-price marker. This hides, visually, how far price has
   already moved.
4. **ARB/RB/IRB detectors require a confirmed breakout candle** — they only
   fire once `candles[index].close` has already closed beyond the range
   (`arb.ts:51-57`, `rb.ts:74-80`, `irb.ts:47-54`). Four other detectors (BB,
   FB, DDB, SB) already fire once the setup/range is "ready," using entry as
   a pending stop-order level rather than waiting for a filled breakout.
   **Investigated and rejected as a fix for ARB/RB/IRB**: BB's pre-breakout
   approach works because BB requires a trend (EMA21 sloping), so direction
   is knowable in advance. ARB and RB explicitly require EMA21 to be *flat*
   before the breakout (`arb.ts:80-86`, `rb.ts:93-96` both reject the setup
   if the EMA was already sloping) — that is, "which way this breaks" is
   genuinely undetermined until price actually breaks a side. IRB's
   direction likewise comes from which side price actually breaks
   (`irb.ts` `breaksInDirection`), not from a pre-existing trend. Sending a
   directional alert before breakout is therefore not possible for these
   three without inventing a new mechanism (e.g. dual pending orders on both
   sides), which is out of scope for this fix (see Non-goals). ARB/RB/IRB
   keep their confirmed-breakout behavior; items 1 and 2 above (distance
   gate, 1-candle lookback) remain the mitigation for their alert timing.

Additionally, the user wants:

5. A breakeven reminder when a trade reaches 1R (TP itself remains 2R,
   unchanged).
6. Binance live order execution temporarily disabled while the signal-only
   flow is refined; Binance trade automation will be revisited later.

## Goals

- Signals should reflect a setup that is still actionable at time of sending.
- Reduce alert latency for ARB/RB/IRB via tighter lookback, without changing
  their confirmed-breakout detection logic (see item 4 below for why
  pre-breakout alerting isn't applicable to them).
- Charts should make it visually obvious how far price has moved since the
  trigger.
- Open positions should prompt a breakeven reminder at 1R.
- No real orders should reach Binance until re-enabled deliberately.

## Non-goals

- No change to TP calculation (`TP_R_MULTIPLE` stays 2R).
- No pre-breakout/early alerting for ARB, RB, or IRB — investigated and
  rejected; see item 4. These three keep their existing confirmed-breakout
  gate unchanged.
- No dual pending-order ("straddle both directions") mechanism for Range-type
  setups — considered as an alternative to pre-breakout alerting and
  explicitly declined by the user as out of scope for this fix.
- No "setup expired/invalidated" notification for pre-breakout signals that
  never break out (explicitly out of scope per user decision).
- No backtesting framework changes; existing `isFalseBreak` post-hoc
  confirmation logic is left as-is where still applicable.
- No change to Binance order-placement code itself — disabling trading is a
  config change only (existing flags already fully separate signal sending
  from order placement).

## Design

### 1. Entry-distance gate (skip, not warn)

Add `isEntryTooFarFromMarket()` in `signal-freshness.ts`, invoked immediately
before a signal is sent to Telegram (in addition to, not replacing, the
existing full TP1/SL breach check):

- `progress = |livePrice - entry| / |TP1 - entry|`
- If `progress >= SIGNAL_MAX_ENTRY_DISTANCE_PCT` (env-configurable, default
  `50`), skip sending the signal entirely and log the reason, following the
  existing stale-reason logging pattern in `signal-freshness.ts`.
- Applies uniformly to long and short setups.
- Config threshold added to `volman-config-env.ts` alongside the existing
  `getConfiguredChartSignalConfidenceThreshold()`-style getters.

### 2. Lookback window: 5 candles → 1 candle

In `deterministic-pipeline.ts`, change `startDetectIndex` so detection only
considers the most recently closed candle (`startDetectIndex = lastIndex`
instead of `max(30, lastIndex - 5)`).

Trade-off (explicit, accepted by user): if a scheduled run is delayed or
missed, a trigger on the skipped candle will never be detected retroactively
— it is dropped rather than reported late. This is intentional: a missed
signal is preferred over a stale one.

### 3. Chart: render live price and extend candle window

In `signal-assembly.ts`, change the candle slice from
`[triggerIndex-60, triggerIndex+2]` to extend through the latest available
candle instead of a fixed `+2` offset.

In `setup-chart-renderer.ts`, add a distinctly-colored live-price line/label
(separate from the existing entry/SL/TP dashed lines) marking the current
price, so the visual gap between entry and current price is immediately
apparent even in cases the distance gate doesn't skip (e.g. progress just
under the 50% threshold).

### 4. ARB/RB/IRB: no pre-breakout alerting (rejected — kept as-is)

Investigated and rejected. BB's pre-breakout alert is possible because BB
requires a trend, so direction is known before the block breaks. ARB and RB
require EMA21 to be *flat* before the breakout by definition
(`arb.ts:80-86`, `rb.ts:93-96`), and IRB's direction is determined purely by
which side price actually breaks (`irb.ts` `breaksInDirection`). None of the
three have a direction signal available before the breakout candle exists,
so there is no sound way to send a directional stop-order alert early for
them. A dual pending-order ("send both a BUY_STOP and a SELL_STOP, cancel
whichever doesn't fill") mechanism was considered as an alternative and
explicitly declined by the user as out of scope.

ARB, RB, and IRB detection logic is unchanged by this plan. Their alert
latency is mitigated only by items 1 (entry-distance gate) and 2 (1-candle
lookback) above.

### 5. Breakeven reminder at 1R

TP remains 2R, unchanged. Add a new intermediate check in
`position-decision-volman.ts`, evaluated in this order per open position per
run:

1. **Existing checks first**: has price already hit the final TP (2R) or the
   original SL? If so, close the position exactly as today (unchanged
   behavior) — a breakeven reminder is never sent for a position that closes
   in the same check.
2. **New check**: if not closed, and price has reached `oneRLevel` (`entry +
   R` for long, `entry - R` for short, where `R = |entry - stopLoss|`), and
   this position has not yet been notified — send a Telegram message (same
   builder-pattern style as `buildPositionClosedMessage` in
   `telegram-volman.ts`) reminding the user to move SL to entry, then:
   - Update the position record's `stopLoss` field to `entry`.
   - Mark the position as notified (new field, e.g. `breakevenNotifiedAt`) so
     the reminder is sent at most once per position.
3. Future SL-hit checks for this position now compare against the updated
   (breakeven) SL, so a subsequent close is correctly reported as breakeven
   rather than a loss.

This assumes manual execution (see item 6) — no Binance API call is made to
actually modify the stop order; the user moves it manually after the
Telegram reminder.

### 6. Disable Binance live trading (config only)

Set `BINANCE_LIVE_TRADING_ENABLED=false` and
`BINANCE_LIVE_TRADING_ENABLED_VOLMAN=false`. Both flags already gate
`openBinanceFuturesPosition` and `pollPendingEntryOrders`
(`index.ts:254-255`, `371`) independently of Telegram signal
generation/sending (`sendAllAnalysesVolman`, `index.ts:288`) and independently
of `runCheckOpenTrades` (which only acts on positions with `binanceSymbol`
set). No code changes required for this item.

## Testing

- Unit tests for `isEntryTooFarFromMarket()`: 0%, 49%, 50%, 100%+ progress,
  both long and short.
- Unit test for lookback change: a trigger on candle `N-1` must not be
  detected when the pipeline runs at candle `N`.
- Unit tests for the 1R breakeven check: reaches 1R without touching TP/SL →
  notify once, SL updated to entry; reaches 1R then later returns to entry →
  reported as breakeven, not loss; hits TP/SL directly without ever reaching
  1R in between → no breakeven notification sent.
- Manual/snapshot check of chart renderer output for a case where price has
  moved partway toward TP, confirming the live-price marker is visually
  distinct from entry/SL/TP lines.

## Config additions

- `SIGNAL_MAX_ENTRY_DISTANCE_PCT` (default `50`) — entry-distance gate
  threshold, percent.
- New position-record field: `breakevenNotifiedAt` (timestamp, nullable).
