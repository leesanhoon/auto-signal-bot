# Position Management Notification Scope — Design

## Context

`runCheckOpenTrades` (src/charts/check-open-trades-runner-volman.ts) checks every open
Volman position on each run and sends a Telegram message every time — even when the
decision is `HOLD` (position unchanged). This produces frequent noise notifications.

The user wants Telegram notifications for open-position management limited to:

1. Position closed by stop loss hit.
2. Position closed by take profit hit.
3. Position closed by EMA21 exit (close below EMA21 in an uptrend LONG, or close above
   EMA21 in a downtrend SHORT).

All other checks (position still open, nothing triggered) should not send a notification.

## Current behavior

`processPosition()`:
- Always calls `evaluateOpenPosition()` → returns a `PositionDecisionOutcome`
  (`HOLD` | `CLOSE` | `STOP`).
- `buildPositionManagementPatch()` → `deriveManagementPatch()` (position-engine-volman.ts)
  already returns `closePosition: true` only when `decision.decision !== "HOLD"`, i.e.
  exactly for SL hit, TP hit, and EMA exit (all three currently resolve to `STOP` or
  `CLOSE`, never `HOLD`). `HOLD` is returned for "checked, nothing triggered."
- If `shouldClose`: sends the closed-position message.
- If not: sends a "decision" message anyway (this is the noise to remove).
- On errors (missing chart config, OHLC fetch failure, exception during check) the
  function currently sends explicit warning messages — these are system/data errors,
  not routine position updates, and must be kept unchanged.

## Change

In `processPosition()` (src/charts/check-open-trades-runner-volman.ts):

- Keep sending the closed-position message when `shouldClose` is `true` (unchanged).
- When `shouldClose` is `false` (decision is `HOLD`): still call `updatePositionDecision`
  to persist `lastDecision`/`lastDecisionComment` as today, but do **not** call
  `sendMessage`, and return `false` so it is not counted toward `notificationsSent`.

No changes to:
- `resolveOpenPositionDecision`, `resolveEmaExitDecision`, `reconcileBinancePosition`, or
  any SL/TP/EMA-exit decision logic — behavior for what counts as a close is already
  correct.
- The error/warning notifications for missing chart config, failed OHLC fetch, or
  exceptions caught in `runCheckOpenTrades` — these remain sent every time, per user
  decision.
- Pending-order checks (`check-pending-orders-runner-volman.ts`) — out of scope.

## Testing

- Unit/integration test around `processPosition` (or the runner) asserting:
  - `sendMessage` is called when decision is `STOP` (SL hit).
  - `sendMessage` is called when decision is `CLOSE` (TP hit).
  - `sendMessage` is called when decision is `STOP` via EMA exit.
  - `sendMessage` is NOT called when decision is `HOLD`, but `updatePositionDecision`
    still runs.
- Existing tests covering error-path notifications (missing config, OHLC fetch failure)
  must still pass unchanged.
