import type { OpenPosition } from "./positions-repository-volman.js";
import type { CandleRangeStats } from "./chart-types-common.js";
import type { PendingOrder } from "./chart-types-common.js";
import type { PositionDecisionOutcome } from "./position-engine-volman.js";
import { resolveEmaExitDecision } from "./position-ema-exit.js";

function parsePrice(value: string | number | null | undefined): number | null {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number): string {
  const precision = value >= 1000 ? 2 : value >= 100 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(precision);
}

function buildHoldDecision(comment: string): PositionDecisionOutcome {
  return {
    decision: "HOLD",
    confidence: 50,
    comment,
    managementAction: "NONE",
    partialClosePercent: 0,
    newStopLoss: null,
    tp1Reached: false,
    tp2Reached: false,
    riskReward: null,
    tp1RiskReward: null,
    tp2RiskReward: null,
  };
}

function buildStopDecision(comment: string): PositionDecisionOutcome {
  return {
    decision: "STOP",
    confidence: 99,
    comment,
    managementAction: "NONE",
    partialClosePercent: 0,
    newStopLoss: null,
    tp1Reached: false,
    tp2Reached: false,
    riskReward: null,
    tp1RiskReward: null,
    tp2RiskReward: null,
  };
}

function buildCloseDecision(comment: string): PositionDecisionOutcome {
  return {
    decision: "CLOSE",
    confidence: 99,
    comment,
    managementAction: "TP2_CLOSE",
    partialClosePercent: 0,
    newStopLoss: null,
    tp1Reached: true,
    tp2Reached: true,
    riskReward: null,
    tp1RiskReward: null,
    tp2RiskReward: null,
  };
}

function buildPartialTp1Decision(comment: string, entry: string): PositionDecisionOutcome {
  return {
    decision: "HOLD",
    confidence: 96,
    comment,
    managementAction: "PARTIAL_TP1",
    partialClosePercent: 50,
    newStopLoss: entry,
    tp1Reached: true,
    tp2Reached: false,
    riskReward: null,
    tp1RiskReward: null,
    tp2RiskReward: null,
  };
}

function buildTrailDecision(comment: string, entry: string): PositionDecisionOutcome {
  return {
    decision: "HOLD",
    confidence: 91,
    comment,
    managementAction: "MOVE_SL_TO_BE",
    partialClosePercent: 0,
    newStopLoss: entry,
    tp1Reached: false,
    tp2Reached: false,
    riskReward: null,
    tp1RiskReward: null,
    tp2RiskReward: null,
  };
}

function isMeaningfullyDifferent(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b;
  return Math.abs(a - b) > 1e-10;
}

function shouldMoveStopToBreakeven(direction: "LONG" | "SHORT", trailingStopLoss: number | null, entry: number): boolean {
  if (trailingStopLoss === null) return true;
  if (direction === "LONG") {
    return trailingStopLoss < entry && isMeaningfullyDifferent(trailingStopLoss, entry);
  }
  return trailingStopLoss > entry && isMeaningfullyDifferent(trailingStopLoss, entry);
}

export function resolveOpenPositionDecision(
  position: Pick<OpenPosition, "direction" | "entry" | "stopLoss" | "takeProfit1" | "takeProfit2" | "tradeStage" | "tp1ClosedPercent" | "trailingStopLoss">,
  stats: CandleRangeStats | null,
  reason?: "ohlc_fetch_fail" | "missing_chart_config",
  emaContext?: { emaValue: number | null; period: number; lastClose: number | null } | null,
): PositionDecisionOutcome {
  if (stats === null) {
    const comment = reason === "missing_chart_config"
      ? "Không tìm thấy cấu hình chart để kiểm tra SL/TP, giữ vị thế."
      : "Chưa lấy được OHLC để kiểm tra SL/TP, giữ vị thế.";
    return buildHoldDecision(comment);
  }

  const stopLoss = parsePrice(position.stopLoss);
  const takeProfit1 = parsePrice(position.takeProfit1);
  const takeProfit2 = position.takeProfit2 ? parsePrice(position.takeProfit2) : null;
  const entry = parsePrice(position.entry);
  if (stopLoss === null || takeProfit1 === null || entry === null || (position.takeProfit2 !== null && takeProfit2 === null)) {
    return buildHoldDecision("Dữ liệu SL/TP không hợp lệ, giữ vị thế.");
  }

  const tp1AlreadyClosed = (position.tp1ClosedPercent ?? 0) > 0 || position.tradeStage === "tp1_partial" || position.tradeStage === "trailing";

  if (position.direction === "LONG") {
    if (stats.low <= stopLoss) {
      return buildStopDecision(`Giá thấp nhất ${formatPrice(stats.low)} đã chạm stop loss ${formatPrice(stopLoss)}.`);
    }

    if (takeProfit2 !== null && stats.high >= takeProfit2) {
      return buildCloseDecision(`Giá cao nhất ${formatPrice(stats.high)} đã chạm TP2 ${formatPrice(takeProfit2)}.`);
    }

    if (!tp1AlreadyClosed && stats.high >= takeProfit1) {
      return buildPartialTp1Decision(`Giá cao nhất ${formatPrice(stats.high)} đã chạm TP1 ${formatPrice(takeProfit1)}.`, position.entry);
    }

    if (tp1AlreadyClosed && shouldMoveStopToBreakeven(position.direction, parsePrice(position.trailingStopLoss), entry)) {
      return buildTrailDecision("Đã partial TP1, dời SL về entry theo dữ liệu OHLC.", position.entry);
    }
  } else {
    if (stats.high >= stopLoss) {
      return buildStopDecision(`Giá cao nhất ${formatPrice(stats.high)} đã chạm stop loss ${formatPrice(stopLoss)}.`);
    }

    if (takeProfit2 !== null && stats.low <= takeProfit2) {
      return buildCloseDecision(`Giá thấp nhất ${formatPrice(stats.low)} đã chạm TP2 ${formatPrice(takeProfit2)}.`);
    }

    if (!tp1AlreadyClosed && stats.low <= takeProfit1) {
      return buildPartialTp1Decision(`Giá thấp nhất ${formatPrice(stats.low)} đã chạm TP1 ${formatPrice(takeProfit1)}.`, position.entry);
    }

    if (tp1AlreadyClosed && shouldMoveStopToBreakeven(position.direction, parsePrice(position.trailingStopLoss), entry)) {
      return buildTrailDecision("Đã partial TP1, dời SL về entry theo dữ liệu OHLC.", position.entry);
    }
  }

  if (emaContext) {
    const emaDecision = resolveEmaExitDecision(position.direction, emaContext.lastClose, emaContext.emaValue, emaContext.period);
    if (emaDecision) return emaDecision;
  }

  return buildHoldDecision("Chưa chạm SL/TP theo dữ liệu OHLC.");
}

export function resolvePendingOrderDecision(
  order: Pick<PendingOrder, "direction" | "entry" | "stopLoss" | "orderType">,
  stats: CandleRangeStats | null,
  reason?: "ohlc_fetch_fail" | "missing_chart_config",
): { status: "TRIGGERED" | "CANCELLED" | "PENDING"; confidence: number; comment: string } {
  if (stats === null) {
    const comment = reason === "missing_chart_config"
      ? "Không tìm thấy cấu hình chart để kiểm tra lệnh chờ, giữ pending."
      : "Chưa lấy được OHLC để kiểm tra lệnh chờ, giữ pending.";
    return {
      status: "PENDING",
      confidence: 0,
      comment,
    };
  }

  const entry = parsePrice(order.entry);
  const stopLoss = parsePrice(order.stopLoss);
  if (entry === null || stopLoss === null) {
    return {
      status: "PENDING",
      confidence: 0,
      comment: "Dữ liệu entry/stop loss không hợp lệ, giữ pending.",
    };
  }

  const invalidated = order.direction === "LONG" ? stats.low <= stopLoss : stats.high >= stopLoss;
  if (invalidated) {
    return {
      status: "CANCELLED",
      confidence: 98,
      comment: order.direction === "LONG"
        ? `Giá thấp nhất ${formatPrice(stats.low)} đã xuyên stop loss ${formatPrice(stopLoss)}, hủy lệnh chờ.`
        : `Giá cao nhất ${formatPrice(stats.high)} đã xuyên stop loss ${formatPrice(stopLoss)}, hủy lệnh chờ.`,
    };
  }

  if (order.orderType === "WAIT_FOR_CONFIRMATION") {
    if (stats.lastClose === null) {
      return {
        status: "PENDING",
        confidence: 50,
        comment: "WAIT_FOR_CONFIRMATION: OHLC thiếu close hợp lệ, giữ pending cho tới khi có dữ liệu xác nhận.",
      };
    }

    const confirmed =
      order.direction === "LONG"
        ? stats.high >= entry && stats.lastClose >= entry
        : stats.low <= entry && stats.lastClose <= entry;
    if (confirmed) {
      return {
        status: "TRIGGERED",
        confidence: 92,
        comment:
          order.direction === "LONG"
            ? `WAIT_FOR_CONFIRMATION: high ${formatPrice(stats.high)} và close ${formatPrice(stats.lastClose)} đã xác nhận entry ${formatPrice(entry)}.`
            : `WAIT_FOR_CONFIRMATION: low ${formatPrice(stats.low)} và close ${formatPrice(stats.lastClose)} đã xác nhận entry ${formatPrice(entry)}.`,
      };
    }

    return {
      status: "PENDING",
      confidence: 50,
      comment: "WAIT_FOR_CONFIRMATION: chưa có close xác nhận entry, giữ pending cho tới expiry.",
    };
  }

  const triggered = (() => {
    switch (order.orderType) {
      case "BUY_STOP":
        return stats.high >= entry;
      case "SELL_STOP":
        return stats.low <= entry;
      case "BUY_LIMIT":
        return stats.low <= entry;
      case "SELL_LIMIT":
        return stats.high >= entry;
      default:
        return false;
    }
  })();

  if (triggered) {
    return {
      status: "TRIGGERED",
      confidence: 96,
      comment: `Giá high ${formatPrice(stats.high)} / low ${formatPrice(stats.low)} đã chạm entry ${formatPrice(entry)}.`,
    };
  }

  return {
    status: "PENDING",
    confidence: 50,
    comment: "Chưa chạm entry theo dữ liệu OHLC, giữ pending.",
  };
}
