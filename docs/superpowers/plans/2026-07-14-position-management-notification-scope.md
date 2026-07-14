# Position Management Notification Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sending a Telegram notification on every open-position check; only notify when a position actually closes (SL hit, TP hit, or EMA21 trend exit).

**Architecture:** `processPosition()` in `src/charts/check-open-trades-runner-volman.ts` already computes a `shouldClose` boolean from `buildPositionManagementPatch()` — it is `true` exactly when the decision is `STOP` (SL hit or EMA21 exit) or `CLOSE` (TP hit), and `false` for `HOLD` (nothing triggered). Today the function sends a Telegram message in both branches. The fix restricts `sendMessage` to the `shouldClose` branch only; the `HOLD` branch still persists `lastDecision` via `updatePositionDecision` (unchanged) but sends nothing and reports no notification.

**Tech Stack:** TypeScript, Vitest, existing `positions-repository-volman.js` / `telegram-client.js` mocks.

## Global Constraints

- Do not change SL/TP/EMA-exit decision logic (`resolveOpenPositionDecision`, `resolveEmaExitDecision`, `reconcileBinancePosition`) — it already classifies correctly per spec.
- Do not change the error/warning notifications for missing chart config, failed OHLC fetch, or exceptions caught in `runCheckOpenTrades` — these must keep firing every time (per spec `docs/superpowers/specs/2026-07-14-position-management-notification-scope-design.md`).
- Do not touch `check-pending-orders-runner-volman.ts` — out of scope.
- `updatePositionDecision` must still be called on every check regardless of whether a notification is sent, so `lastDecision`/`lastDecisionComment` stay current in the DB.

---

### Task 1: Suppress HOLD notifications in processPosition

**Files:**
- Modify: `src/charts/check-open-trades-runner-volman.ts:61-112` (the `processPosition` function)
- Test: `tests/charts/check-open-trades-runner-volman.test.ts`

**Interfaces:**
- Consumes: `buildPositionManagementPatch(position, decision)` → `{ patch, closePosition }` (existing, from `positions-repository-volman.js`, unchanged).
- Produces: `processPosition(position): Promise<boolean>` — return value now means "a Telegram notification was sent" (`true` only on close); callers (`runCheckOpenTrades`) already sum this into `notificationsSent`, no signature change.

- [ ] **Step 1: Update the existing HOLD-path test to expect no notification**

Open `tests/charts/check-open-trades-runner-volman.test.ts` and replace the second test
(`"uses Binance reconcile for an executed position"`, lines 125-143) with:

```ts
  test("uses Binance reconcile for an executed position and sends no notification on HOLD", async () => {
    const executed = { ...position, binanceSymbol: "BTCUSDT" };
    binance.reconcileBinancePosition.mockResolvedValue({
      decision: "HOLD",
      confidence: 100,
      comment: "still open",
      managementAction: "NONE",
    });
    repository.buildPositionManagementPatch.mockReturnValue({
      patch: null,
      closePosition: false,
    });

    const sentNotification = await processPosition(executed as any);

    expect(binance.reconcileBinancePosition).toHaveBeenCalledWith(executed);
    expect(candles.fetchCandleRangeStats).not.toHaveBeenCalled();
    expect(repository.updatePositionDecision).toHaveBeenCalledWith(
      executed.id,
      expect.objectContaining({ decision: "HOLD" }),
      null,
    );
    expect(telegram.buildPositionDecisionMessage).not.toHaveBeenCalled();
    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(sentNotification).toBe(false);
  });
```

Also add a new test directly after it, in the same `describe` block, asserting a STOP
decision from a plain (non-Binance) SL hit still notifies:

```ts
  test("persists and announces a stop-loss close", async () => {
    const decision = {
      decision: "STOP" as const,
      confidence: 99,
      comment: "SL reached",
      managementAction: "NONE" as const,
    };
    decisions.resolveOpenPositionDecision.mockReturnValue(decision);
    repository.buildPositionManagementPatch.mockReturnValue({
      patch: {
        tradeStage: "closed",
        lastManagementAction: "NONE",
      },
      closePosition: true,
    });
    repository.closePosition.mockResolvedValue({
      closeReason: "stop_loss",
      realizedExitPrice: "1.0960",
      realizedRiskRewardRatio: -1,
      outcome: "loss",
    });

    const sentNotification = await processPosition(position as any);

    expect(repository.closePosition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, pair: "EUR/USD" }),
      decision,
      expect.objectContaining({ tradeStage: "closed" }),
    );
    expect(telegram.buildPositionClosedMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, pair: "EUR/USD" }),
      expect.objectContaining({ closeReason: "stop_loss" }),
      expect.any(Object),
    );
    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(sentNotification).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail against current code**

Run: `npx vitest run tests/charts/check-open-trades-runner-volman.test.ts`
Expected: FAIL — `"sends no notification on HOLD"` fails because
`telegramClient.sendMessage` is currently called even on `HOLD` (the old code path
sends `buildPositionDecisionMessage` output unconditionally), so
`expect(telegramClient.sendMessage).not.toHaveBeenCalled()` fails.

- [ ] **Step 3: Modify processPosition to only notify on close**

In `src/charts/check-open-trades-runner-volman.ts`, replace the body of
`processPosition` (currently lines 61-112) with:

```ts
export async function processPosition(position: Awaited<ReturnType<typeof loadOpenPositions>>[number]): Promise<boolean> {
  const decision = await evaluateOpenPosition(position);
  const { patch, closePosition: shouldClose } = buildPositionManagementPatch(position, decision);
  await updatePositionDecision(position.id, decision, patch);

  if (shouldClose) {
    const snapshot = await closePosition(position, decision, patch);
    const closedMessage = buildPositionClosedMessage(
      {
        id: position.id,
        pair: position.pair,
        direction: position.direction,
        setup: position.setup,
        entry: position.entry,
        openedAt: position.openedAt
          ? new Date(position.openedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
          : null,
      },
      snapshot,
      {
        isFailSafeClose:
          position.binanceExecutionStatus === "failed" ||
          position.binanceExecutionStatus === "close_failed",
      },
    );
    await sendMessage(`${closedMessage}\n\n*Cập nhật lúc:* ${formatCheckedAt()}`);
    return true;
  }

  return false;
}
```

This removes the unconditional `buildPositionDecisionMessage` + `sendMessage` call that
previously ran whenever the position was not closing.

- [ ] **Step 4: Remove the now-unused HOLD-path message import if unused elsewhere**

Check whether `buildPositionDecisionMessage` is still used anywhere in
`src/charts/check-open-trades-runner-volman.ts`:

Run: `grep -n "buildPositionDecisionMessage" src/charts/check-open-trades-runner-volman.ts`
Expected: only the import line remains (no call sites).

Update the import on line 4 from:

```ts
import { buildPositionDecisionMessage, buildPositionClosedMessage } from "../shared/telegram-volman.js";
```

to:

```ts
import { buildPositionClosedMessage } from "../shared/telegram-volman.js";
```

- [ ] **Step 5: Run the full test file to verify it passes**

Run: `npx vitest run tests/charts/check-open-trades-runner-volman.test.ts`
Expected: PASS — all 4 tests (`persists and announces a single-TP close`,
`uses Binance reconcile for an executed position and sends no notification on HOLD`,
`persists and announces a stop-loss close`, `runCheckOpenTrades processes every open
position`) pass.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm run test`
Expected: PASS — no other test file references `buildPositionDecisionMessage` from this
runner or depends on `processPosition` sending a message on `HOLD`. If any test in
`tests/charts/telegram-volman.test.ts` or similar still exercises
`buildPositionDecisionMessage` directly (as a standalone export), that is unaffected
since the function itself is not deleted — only its call site here is removed.

- [ ] **Step 7: Run the TypeScript build to confirm no type errors**

Run: `npm run build`
Expected: PASS — no unused-import or type errors.

- [ ] **Step 8: Commit**

```bash
git add src/charts/check-open-trades-runner-volman.ts tests/charts/check-open-trades-runner-volman.test.ts
git commit -m "fix: only notify Telegram when a position closes (SL/TP/EMA exit)"
```
