# TradingView Volman BB/RB Pine Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two standalone TradingView Pine Script v6 files (indicator + strategy) that replicate the BB (Block Break) and RB (Range Break) entry/exit logic of the existing Volman bot (`src/charts/setups/bb.ts`, `src/charts/setups/rb.ts`), for manual visual monitoring and Strategy Tester backtesting on TradingView.

**Architecture:** Two self-contained `.pine` files under `pinescript/` — no shared imports (Pine has no practical shared-library mechanism across indicator/strategy scripts for unpublished, single-user scripts). Both files duplicate the same core detection logic (EMA21, ATR14, trend slope classifier, BB/RB compression detectors). The indicator file tracks one active "virtual trade" at a time using `var` state + `line`/`label` drawings to visualize SL/TP/breakeven/EMA-exit. The strategy file uses native `strategy.entry`/`strategy.exit`/`strategy.close` for the same logic so it can run in TradingView's Strategy Tester.

**Tech Stack:** Pine Script v6 (TradingView). No local build/test tooling exists for Pine — verification is manual: load the script in TradingView's Pine Editor, confirm it compiles with no errors, and visually confirm behavior on a chart. This replaces the automated-test steps used in typical implementation plans (see Global Constraints).

## Global Constraints

- Language/version: Pine Script **v6** (`//@version=6`), required for both files.
- Scope: **only BB and RB setups**. Do not implement SB, IRB, ARB, DDB, FB.
- **No** session/time filter, **no** ATR floor, **no** confidence score, **no** entry-distance guard.
- Scripts must run on **any timeframe/symbol** the user has open on TradingView — never hardcode timeframe or symbol.
- `TP_R_MULTIPLE` default is **2.0** (2R), matching the bot's default.
- EMA period default is **21**, ATR period default is **14**, matching the bot's defaults.
- Indicator file must expose `alertcondition()` for: BB Long, BB Short, RB Long, RB Short — for the user to configure TradingView alerts manually. No webhook JSON payload, no auto-trading.
- Only one virtual/actual trade open at a time (no pyramiding, no stacking signals).
- Since there is no automated test runner for Pine Script, every task's "verification" step is a **manual checklist to run in TradingView's Pine Editor** (paste script → "Add to Chart" → confirm no compile errors → visually confirm the described behavior). Do not claim a task is done without completing this checklist and reporting what was observed.
- Spec reference: `docs/superpowers/specs/2026-07-14-tradingview-volman-bb-rb-script-design.md`

---

## Task 1: Indicator skeleton — EMA21, ATR14, Trend Slope Classifier

**Files:**
- Create: `pinescript/volman-bb-rb-indicator.pine`

**Interfaces:**
- Produces: input variables `emaPeriod`, `atrPeriod`, `trendSlopeThreshold`, `trendCandleWindow`, `trendCandleMinCount`, `bbWindow`, `bbKBlock`, `bbNearEmaAtrMult`, `rbWindow`, `rbKBlock`, `rbMinTouches`, `rbTouchAtrMult`, `tpRMultiple`, `emaExitEnabled`, `enableBB`, `enableRB` (all declared in this task even though some are unused until later tasks — Pine requires no forward declaration, but declaring all inputs now keeps the input panel stable across tasks).
- Produces: series `ema21`, `atr14`, `slope`, `isUptrend`, `isDowntrend` — consumed by Tasks 2–4.

- [ ] **Step 1: Write the indicator file**

```pinescript
//@version=6
indicator("Volman BB/RB", overlay=true, max_lines_count=200, max_labels_count=200)

// ---------- Inputs ----------
emaPeriod           = input.int(21, "EMA Period", minval=1, group="Core")
atrPeriod           = input.int(14, "ATR Period", minval=1, group="Core")
trendSlopeThreshold = input.float(0.15, "Trend Slope Threshold", minval=0.0, step=0.01, group="Trend")
trendCandleWindow   = input.int(10, "Trend Candle Window", minval=1, group="Trend")
trendCandleMinCount = input.int(6, "Trend Candle Min Count", minval=1, group="Trend")
bbWindow            = input.int(5, "BB Compression Window", minval=2, group="BB")
bbKBlock            = input.float(1.2, "BB kBlock", minval=0.1, step=0.1, group="BB")
bbNearEmaAtrMult    = input.float(1.0, "BB Block-to-EMA Max Distance (x ATR)", minval=0.1, step=0.1, group="BB")
rbWindow            = input.int(8, "RB Compression Window", minval=2, group="RB")
rbKBlock            = input.float(2.0, "RB kBlock", minval=0.1, step=0.1, group="RB")
rbMinTouches        = input.int(2, "RB Min Boundary Touches", minval=1, group="RB")
rbTouchAtrMult      = input.float(0.1, "RB Touch Tolerance (x ATR)", minval=0.01, step=0.01, group="RB")
tpRMultiple         = input.float(2.0, "TP R Multiple", minval=0.1, step=0.1, group="Exit")
emaExitEnabled      = input.bool(true, "Enable EMA Exit", group="Exit")
enableBB            = input.bool(true, "Enable BB Setup", group="Setups")
enableRB            = input.bool(true, "Enable RB Setup", group="Setups")

// ---------- Core indicators ----------
ema21 = ta.ema(close, emaPeriod)
tr    = ta.tr(true)
atr14 = ta.ema(tr, atrPeriod)

// ---------- Trend slope classifier ----------
slope      = (ema21 - ema21[5]) / atr14
aboveCount = math.sum(close > ema21 ? 1.0 : 0.0, trendCandleWindow)
belowCount = math.sum(close < ema21 ? 1.0 : 0.0, trendCandleWindow)
isUptrend   = slope > trendSlopeThreshold and aboveCount >= trendCandleMinCount
isDowntrend = slope < -trendSlopeThreshold and belowCount >= trendCandleMinCount

plot(ema21, "EMA21", color=color.orange, linewidth=2)
```

- [ ] **Step 2: Manual verification**

Open [TradingView Pine Editor](https://www.tradingview.com/pine-editor/), paste the file content, click "Add to Chart" on any symbol/timeframe.

Checklist:
- [ ] Script compiles with **no errors** in the console at the bottom of the editor.
- [ ] An orange EMA21 line is plotted on the chart, tracking price.
- [ ] The Settings (gear icon) panel shows input groups "Core", "Trend", "BB", "RB", "Exit", "Setups" with the fields listed above.

Report exactly what you saw (compile errors if any, screenshot description).

- [ ] **Step 3: Commit**

```bash
git add pinescript/volman-bb-rb-indicator.pine
git commit -m "feat: add Volman indicator skeleton with EMA/ATR/trend classifier"
```

---

## Task 2: Indicator — BB compression detector, BB entry, SL/TP tracking, BB alerts

**Files:**
- Modify: `pinescript/volman-bb-rb-indicator.pine` (append after the Task 1 content, before nothing — this is the new end of file)

**Interfaces:**
- Consumes: `ema21`, `atr14`, `slope`, `isUptrend`, `isDowntrend`, and all inputs from Task 1.
- Produces: `bbLongCond`, `bbShortCond` (bool series) — consumed by Task 3 (priority logic) and Task 4 (exit reason labeling). Produces `activeEntry`, `activeSL`, `activeTP`, `activeSide`, `activeBE`, `slLine`, `tpLine`, `entryLabel` (var state) — consumed by Task 4.

- [ ] **Step 1: Append BB detection, single-trade tracking, and BB alerts**

Add this to the end of `pinescript/volman-bb-rb-indicator.pine`:

```pinescript
// ---------- BB compression + entry ----------
blockHigh    = ta.highest(high[1], bbWindow)
blockLow     = ta.lowest(low[1], bbWindow)
blockRange   = blockHigh - blockLow
isTightBlock = blockRange <= bbKBlock * atr14
blockMid     = (blockHigh + blockLow) / 2
nearEma      = math.abs(blockMid - ema21) <= bbNearEmaAtrMult * atr14

bbLongCond  = enableBB and isUptrend   and isTightBlock and nearEma and close > blockHigh and close[1] <= blockHigh
bbShortCond = enableBB and isDowntrend and isTightBlock and nearEma and close < blockLow  and close[1] >= blockLow

// ---------- Active trade tracking (single trade at a time) ----------
var float activeEntry = na
var float activeSL    = na
var float activeTP    = na
var string activeSide = na
var bool  activeBE    = false
var line  slLine      = na
var line  tpLine      = na
var label entryLabel  = na

canOpenNewTrade = na(activeEntry)

if canOpenNewTrade and bbLongCond
    risk = close - blockLow
    activeEntry := close
    activeSL    := blockLow
    activeTP    := close + tpRMultiple * risk
    activeSide  := "long"
    activeBE    := false
    entryLabel := label.new(bar_index, low, "BB LONG", style=label.style_label_up, color=color.green, textcolor=color.white, yloc=yloc.belowbar)
    slLine := line.new(bar_index, activeSL, bar_index, activeSL, extend=extend.right, color=color.red, width=1)
    tpLine := line.new(bar_index, activeTP, bar_index, activeTP, extend=extend.right, color=color.green, width=1)

if canOpenNewTrade and bbShortCond and na(activeEntry)
    risk = blockHigh - close
    activeEntry := close
    activeSL    := blockHigh
    activeTP    := close - tpRMultiple * risk
    activeSide  := "short"
    activeBE    := false
    entryLabel := label.new(bar_index, high, "BB SHORT", style=label.style_label_down, color=color.red, textcolor=color.white, yloc=yloc.abovebar)
    slLine := line.new(bar_index, activeSL, bar_index, activeSL, extend=extend.right, color=color.red, width=1)
    tpLine := line.new(bar_index, activeTP, bar_index, activeTP, extend=extend.right, color=color.green, width=1)

// ---------- Alerts ----------
alertcondition(bbLongCond,  title="BB Long",  message="Volman BB Long signal")
alertcondition(bbShortCond, title="BB Short", message="Volman BB Short signal")
```

- [ ] **Step 2: Manual verification**

Paste the updated full file into Pine Editor, "Add to Chart" on a symbol/timeframe with visible consolidation-then-breakout patterns (try BTCUSDT 15m on Binance).

Checklist:
- [ ] Script compiles with no errors.
- [ ] Scroll through chart history: at least one "BB LONG" or "BB SHORT" label appears at a bar where price breaks out of a tight consolidation near the EMA21, in the direction of the prevailing trend.
- [ ] A red line (SL) and a green line (TP) extend to the right starting from each entry label's bar.
- [ ] Only one entry label appears at a time — no new label appears while a red/green line pair is still extending (since Task 4, which closes trades, hasn't been added yet, this means only the very first signal in the visible history should draw lines — confirm no second label appears after the first).
- [ ] Open Settings → confirm `alertcondition` targets "BB Long" and "BB Short" appear when creating a new Alert on this indicator (TradingView Alert dialog → Condition dropdown → select this indicator → confirm the two conditions are listed).

Report what you saw, including any compile errors.

- [ ] **Step 3: Commit**

```bash
git add pinescript/volman-bb-rb-indicator.pine
git commit -m "feat: add BB entry detection and SL/TP tracking to Volman indicator"
```

---

## Task 3: Indicator — RB compression detector, RB entry (priority under BB), RB alerts

**Files:**
- Modify: `pinescript/volman-bb-rb-indicator.pine`

**Interfaces:**
- Consumes: everything from Tasks 1–2, especially `bbLongCond`, `bbShortCond`, `canOpenNewTrade`.
- Produces: `rbLongCond`, `rbShortCond` — consumed by Task 4.

- [ ] **Step 1: Insert RB detection between the BB block and the trade-tracking block**

In `pinescript/volman-bb-rb-indicator.pine`, insert this new section **immediately after** the `bbShortCond` line and **before** the `// ---------- Active trade tracking` comment:

```pinescript
// ---------- RB compression + entry ----------
rbHigh       = ta.highest(high[1], rbWindow)
rbLow        = ta.lowest(low[1], rbWindow)
rbRange      = rbHigh - rbLow
isTightRange = rbRange <= rbKBlock * atr14
flatBefore   = math.abs(slope[1]) <= trendSlopeThreshold

touchTolerance  = rbTouchAtrMult * atr14
touchHighSeries = (rbHigh - high) <= touchTolerance ? 1.0 : 0.0
touchLowSeries  = (low - rbLow)  <= touchTolerance ? 1.0 : 0.0
touchesHigh = math.sum(touchHighSeries[1], rbWindow)
touchesLow  = math.sum(touchLowSeries[1], rbWindow)

rbLongBreak  = close > rbHigh and close[1] <= rbHigh
rbShortBreak = close < rbLow  and close[1] >= rbLow

rbLongCond  = enableRB and isTightRange and flatBefore and touchesHigh >= rbMinTouches and rbLongBreak  and slope > 0
rbShortCond = enableRB and isTightRange and flatBefore and touchesLow  >= rbMinTouches and rbShortBreak and slope < 0
```

Then **replace** the two `if canOpenNewTrade and bbLongCond` / `if canOpenNewTrade and bbShortCond and na(activeEntry)` blocks with versions that also check RB, giving BB priority when both fire on the same bar:

```pinescript
longSignal  = bbLongCond or rbLongCond
shortSignal = bbShortCond or rbShortCond

if canOpenNewTrade and longSignal
    isBB  = bbLongCond
    slLevel = isBB ? blockLow : rbLow
    risk = close - slLevel
    activeEntry := close
    activeSL    := slLevel
    activeTP    := close + tpRMultiple * risk
    activeSide  := "long"
    activeBE    := false
    entryLabel := label.new(bar_index, low, (isBB ? "BB" : "RB") + " LONG", style=label.style_label_up, color=color.green, textcolor=color.white, yloc=yloc.belowbar)
    slLine := line.new(bar_index, activeSL, bar_index, activeSL, extend=extend.right, color=color.red, width=1)
    tpLine := line.new(bar_index, activeTP, bar_index, activeTP, extend=extend.right, color=color.green, width=1)

if canOpenNewTrade and shortSignal and na(activeEntry)
    isBB  = bbShortCond
    slLevel = isBB ? blockHigh : rbHigh
    risk = slLevel - close
    activeEntry := close
    activeSL    := slLevel
    activeTP    := close - tpRMultiple * risk
    activeSide  := "short"
    activeBE    := false
    entryLabel := label.new(bar_index, high, (isBB ? "BB" : "RB") + " SHORT", style=label.style_label_down, color=color.red, textcolor=color.white, yloc=yloc.abovebar)
    slLine := line.new(bar_index, activeSL, bar_index, activeSL, extend=extend.right, color=color.red, width=1)
    tpLine := line.new(bar_index, activeTP, bar_index, activeTP, extend=extend.right, color=color.green, width=1)
```

Finally, add RB alerts after the existing BB `alertcondition` lines:

```pinescript
alertcondition(rbLongCond,  title="RB Long",  message="Volman RB Long signal")
alertcondition(rbShortCond, title="RB Short", message="Volman RB Short signal")
```

- [ ] **Step 2: Manual verification**

Paste the updated full file into Pine Editor, "Add to Chart".

Checklist:
- [ ] Script compiles with no errors.
- [ ] Scroll through history on a ranging symbol/timeframe (try a pair during a sideways period): at least one "RB LONG" or "RB SHORT" label appears at a breakout from a flat-EMA range with visible boundary touches.
- [ ] Labels now show either "BB LONG"/"BB SHORT" or "RB LONG"/"RB SHORT" (prefix changed from the hardcoded "BB" in Task 2).
- [ ] Alert dialog Condition dropdown now lists all four: BB Long, BB Short, RB Long, RB Short.

Report what you saw, including any compile errors.

- [ ] **Step 3: Commit**

```bash
git add pinescript/volman-bb-rb-indicator.pine
git commit -m "feat: add RB entry detection to Volman indicator with BB priority"
```

---

## Task 4: Indicator — breakeven, EMA exit, TP/SL close, exit labels

**Files:**
- Modify: `pinescript/volman-bb-rb-indicator.pine`

**Interfaces:**
- Consumes: `activeEntry`, `activeSL`, `activeTP`, `activeSide`, `activeBE`, `slLine`, `tpLine`, `ema21`, `emaExitEnabled` from Tasks 1–3.
- Produces: nothing consumed by later tasks (this is the last indicator task).

- [ ] **Step 1: Append trade-management logic to the end of the file**

Add this to the end of `pinescript/volman-bb-rb-indicator.pine` (after the `alertcondition` lines from Task 3):

```pinescript
// ---------- Breakeven + EMA exit + TP/SL exit management ----------
if not na(activeEntry)
    riskMgmt  = activeSide == "long" ? activeEntry - activeSL : activeSL - activeEntry
    oneRLevel = activeSide == "long" ? activeEntry + riskMgmt : activeEntry - riskMgmt

    if not activeBE
        beHit = activeSide == "long" ? high >= oneRLevel : low <= oneRLevel
        if beHit
            activeBE := true
            activeSL := activeEntry
            line.set_y1(slLine, activeEntry)
            line.set_y2(slLine, activeEntry)
            label.new(bar_index, activeSide == "long" ? low : high, "BE", style=label.style_label_up, color=color.blue, textcolor=color.white, size=size.small)

    emaExitHit = emaExitEnabled and ((activeSide == "long" and close < ema21) or (activeSide == "short" and close > ema21))
    tpHit = activeSide == "long" ? high >= activeTP : low <= activeTP
    slHit = activeSide == "long" ? low <= activeSL : high >= activeSL

    if emaExitHit or tpHit or slHit
        exitReason = emaExitHit ? "EMA EXIT" : tpHit ? "TP" : "SL"
        label.new(bar_index, close, exitReason, style=label.style_label_down, color=color.gray, textcolor=color.white, size=size.small)
        line.set_extend(slLine, extend.none)
        line.set_x2(slLine, bar_index)
        line.set_extend(tpLine, extend.none)
        line.set_x2(tpLine, bar_index)
        activeEntry := na
        activeSL    := na
        activeTP    := na
        activeSide  := na
        activeBE    := false
```

- [ ] **Step 2: Manual verification**

Paste the updated full file into Pine Editor, "Add to Chart" on BTCUSDT 15m (or similar), scroll through at least 500 bars of history.

Checklist:
- [ ] Script compiles with no errors.
- [ ] After an entry label, the red SL line stops extending and a small blue "BE" label appears when price moves 1R in the trade's favor; the SL line's right end visually jumps to the entry price level from that point forward.
- [ ] Eventually a gray "TP", "SL", or "EMA EXIT" label appears, and both the red and green lines stop extending further right at that bar.
- [ ] After an exit label, a **new** entry label (BB or RB) can appear on a later bar — confirming the single-trade-at-a-time logic correctly re-arms after each exit.
- [ ] Toggle `Enable EMA Exit` off in Settings — confirm trades no longer exit early on an EMA21 cross, only via SL or TP labels.

Report what you saw, including any compile errors or visually incorrect line/label placement.

- [ ] **Step 3: Commit**

```bash
git add pinescript/volman-bb-rb-indicator.pine
git commit -m "feat: add breakeven, EMA exit, and TP/SL close logic to Volman indicator"
```

---

## Task 5: Strategy — core detection + entries with fixed SL/TP

**Files:**
- Create: `pinescript/volman-bb-rb-strategy.pine`

**Interfaces:**
- Produces: same input names as the indicator (Task 1), plus `entryPrice`, `slPrice`, `tpPrice`, `beDone` (var state) — consumed by Task 6.

- [ ] **Step 1: Write the strategy file**

```pinescript
//@version=6
strategy("Volman BB/RB Strategy", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=10, pyramiding=0)

// ---------- Inputs ----------
emaPeriod           = input.int(21, "EMA Period", minval=1, group="Core")
atrPeriod           = input.int(14, "ATR Period", minval=1, group="Core")
trendSlopeThreshold = input.float(0.15, "Trend Slope Threshold", minval=0.0, step=0.01, group="Trend")
trendCandleWindow   = input.int(10, "Trend Candle Window", minval=1, group="Trend")
trendCandleMinCount = input.int(6, "Trend Candle Min Count", minval=1, group="Trend")
bbWindow            = input.int(5, "BB Compression Window", minval=2, group="BB")
bbKBlock            = input.float(1.2, "BB kBlock", minval=0.1, step=0.1, group="BB")
bbNearEmaAtrMult    = input.float(1.0, "BB Block-to-EMA Max Distance (x ATR)", minval=0.1, step=0.1, group="BB")
rbWindow            = input.int(8, "RB Compression Window", minval=2, group="RB")
rbKBlock            = input.float(2.0, "RB kBlock", minval=0.1, step=0.1, group="RB")
rbMinTouches        = input.int(2, "RB Min Boundary Touches", minval=1, group="RB")
rbTouchAtrMult      = input.float(0.1, "RB Touch Tolerance (x ATR)", minval=0.01, step=0.01, group="RB")
tpRMultiple         = input.float(2.0, "TP R Multiple", minval=0.1, step=0.1, group="Exit")
emaExitEnabled      = input.bool(true, "Enable EMA Exit", group="Exit")
enableBB            = input.bool(true, "Enable BB Setup", group="Setups")
enableRB            = input.bool(true, "Enable RB Setup", group="Setups")

// ---------- Core indicators ----------
ema21 = ta.ema(close, emaPeriod)
tr    = ta.tr(true)
atr14 = ta.ema(tr, atrPeriod)

slope      = (ema21 - ema21[5]) / atr14
aboveCount = math.sum(close > ema21 ? 1.0 : 0.0, trendCandleWindow)
belowCount = math.sum(close < ema21 ? 1.0 : 0.0, trendCandleWindow)
isUptrend   = slope > trendSlopeThreshold and aboveCount >= trendCandleMinCount
isDowntrend = slope < -trendSlopeThreshold and belowCount >= trendCandleMinCount

plot(ema21, "EMA21", color=color.orange, linewidth=2)

// ---------- BB compression + entry ----------
blockHigh    = ta.highest(high[1], bbWindow)
blockLow     = ta.lowest(low[1], bbWindow)
blockRange   = blockHigh - blockLow
isTightBlock = blockRange <= bbKBlock * atr14
blockMid     = (blockHigh + blockLow) / 2
nearEma      = math.abs(blockMid - ema21) <= bbNearEmaAtrMult * atr14

bbLongCond  = enableBB and isUptrend   and isTightBlock and nearEma and close > blockHigh and close[1] <= blockHigh
bbShortCond = enableBB and isDowntrend and isTightBlock and nearEma and close < blockLow  and close[1] >= blockLow

// ---------- RB compression + entry ----------
rbHigh       = ta.highest(high[1], rbWindow)
rbLow        = ta.lowest(low[1], rbWindow)
rbRange      = rbHigh - rbLow
isTightRange = rbRange <= rbKBlock * atr14
flatBefore   = math.abs(slope[1]) <= trendSlopeThreshold

touchTolerance  = rbTouchAtrMult * atr14
touchHighSeries = (rbHigh - high) <= touchTolerance ? 1.0 : 0.0
touchLowSeries  = (low - rbLow)  <= touchTolerance ? 1.0 : 0.0
touchesHigh = math.sum(touchHighSeries[1], rbWindow)
touchesLow  = math.sum(touchLowSeries[1], rbWindow)

rbLongBreak  = close > rbHigh and close[1] <= rbHigh
rbShortBreak = close < rbLow  and close[1] >= rbLow

rbLongCond  = enableRB and isTightRange and flatBefore and touchesHigh >= rbMinTouches and rbLongBreak  and slope > 0
rbShortCond = enableRB and isTightRange and flatBefore and touchesLow  >= rbMinTouches and rbShortBreak and slope < 0

longSignal  = bbLongCond or rbLongCond
shortSignal = bbShortCond or rbShortCond
signalSL_long  = bbLongCond ? blockLow : rbLow
signalSL_short = bbShortCond ? blockHigh : rbHigh

// ---------- Trade state ----------
var float entryPrice = na
var float slPrice    = na
var float tpPrice    = na
var bool  beDone     = false

if strategy.position_size == 0 and longSignal
    riskEntry = close - signalSL_long
    entryPrice := close
    slPrice    := signalSL_long
    tpPrice    := close + tpRMultiple * riskEntry
    beDone     := false
    strategy.entry("Long", strategy.long)
    strategy.exit("Long Exit", from_entry="Long", stop=slPrice, limit=tpPrice)

if strategy.position_size == 0 and shortSignal
    riskEntry = signalSL_short - close
    entryPrice := close
    slPrice    := signalSL_short
    tpPrice    := close - tpRMultiple * riskEntry
    beDone     := false
    strategy.entry("Short", strategy.short)
    strategy.exit("Short Exit", from_entry="Short", stop=slPrice, limit=tpPrice)
```

- [ ] **Step 2: Manual verification**

Paste the file into Pine Editor, "Add to Chart" on BTCUSDT 15m, open the **Strategy Tester** tab at the bottom of TradingView.

Checklist:
- [ ] Script compiles with no errors.
- [ ] Strategy Tester "Overview" tab shows at least one closed trade after scrolling through history.
- [ ] "List of Trades" tab shows entries labeled "Long"/"Short", each with an exit at either the stop or limit price computed as `entry ± 2 * risk` (spot-check one trade's numbers against the chart).
- [ ] No trade overlaps another (pyramiding=0 confirmed — position size never exceeds 1 unit).

Report what you saw, including any compile errors or Strategy Tester numbers that look wrong.

- [ ] **Step 3: Commit**

```bash
git add pinescript/volman-bb-rb-strategy.pine
git commit -m "feat: add Volman BB/RB strategy with fixed SL/TP entries"
```

---

## Task 6: Strategy — breakeven and EMA exit

**Files:**
- Modify: `pinescript/volman-bb-rb-strategy.pine`

**Interfaces:**
- Consumes: `entryPrice`, `slPrice`, `tpPrice`, `beDone`, `ema21`, `emaExitEnabled` from Task 5.

- [ ] **Step 1: Append breakeven and EMA exit logic to the end of the file**

Add this to the end of `pinescript/volman-bb-rb-strategy.pine`:

```pinescript
// ---------- Breakeven ----------
if strategy.position_size > 0 and not beDone
    riskLong = entryPrice - slPrice
    oneRLong = entryPrice + riskLong
    if high >= oneRLong
        beDone := true
        slPrice := entryPrice
        strategy.exit("Long Exit", from_entry="Long", stop=slPrice, limit=tpPrice)

if strategy.position_size < 0 and not beDone
    riskShort = slPrice - entryPrice
    oneRShort = entryPrice - riskShort
    if low <= oneRShort
        beDone := true
        slPrice := entryPrice
        strategy.exit("Short Exit", from_entry="Short", stop=slPrice, limit=tpPrice)

// ---------- EMA exit ----------
if emaExitEnabled and strategy.position_size > 0 and close < ema21
    strategy.close("Long", comment="EMA EXIT")

if emaExitEnabled and strategy.position_size < 0 and close > ema21
    strategy.close("Short", comment="EMA EXIT")
```

- [ ] **Step 2: Manual verification**

Paste the updated full file into Pine Editor, "Add to Chart" on BTCUSDT 15m, open Strategy Tester.

Checklist:
- [ ] Script compiles with no errors.
- [ ] "List of Trades" tab: find a trade that exits with comment "EMA EXIT" — confirm the exit bar's close is on the opposite side of EMA21 from the trade direction.
- [ ] Find a trade whose exit price equals its entry price (a breakeven stop-out) — confirm on the chart that price touched the 1R level before reversing back to entry.
- [ ] Toggle `Enable EMA Exit` off — confirm no more "EMA EXIT" trades appear in a re-run, only TP/SL/breakeven exits.

Report what you saw, including any compile errors or trades that don't match the expected exit reason.

- [ ] **Step 3: Commit**

```bash
git add pinescript/volman-bb-rb-strategy.pine
git commit -m "feat: add breakeven and EMA exit to Volman strategy"
```

---

## Task 7: Side-by-side final verification

**Files:**
- None (verification only).

- [ ] **Step 1: Load both scripts on the same chart**

Add both `pinescript/volman-bb-rb-indicator.pine` and `pinescript/volman-bb-rb-strategy.pine` to the same TradingView chart (BTCUSDT, two different timeframes: 15m and 1h).

Checklist:
- [ ] For at least 3 signals visible in the indicator's history, the strategy's "List of Trades" shows a trade opening on the same bar, same direction, same entry price.
- [ ] SL/TP values from the indicator's lines match the strategy's stop/limit prices for the same trade (spot-check via `line.get_y1`/hovering the chart vs. the Strategy Tester trade detail).
- [ ] Both scripts behave correctly with `enableBB=false, enableRB=true` (only RB signals/trades appear) and `enableBB=true, enableRB=false` (only BB).
- [ ] No console errors in either script across the full verification session.

Report a summary of what matched and any discrepancies found (do not silently fix discrepancies — report them for a follow-up task).

- [ ] **Step 2: Commit (only if Step 1 required file fixes)**

If Step 1 uncovered no issues, skip this step — Task 7 produces no commit. If fixes were needed, make them in the relevant file(s) and commit:

```bash
git add pinescript/volman-bb-rb-indicator.pine pinescript/volman-bb-rb-strategy.pine
git commit -m "fix: reconcile indicator/strategy discrepancies found in side-by-side verification"
```
