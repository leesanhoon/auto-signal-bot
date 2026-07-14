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
  };
}

function buildStopDecision(comment: string): PositionDecisionOutcome {
  return {
    decision: "STOP",
    confidence: 99,
    comment,
    managementAction: "NONE",
  };
}

function buildCloseDecision(comment: string): PositionDecisionOutcome {
  return {
    decision: "CLOSE",
    confidence: 99,
    comment,
    managementAction: "TAKE_PROFIT_CLOSE",
  };
}

function buildBreakevenDecision(comment: string): PositionDecisionOutcome {
  return {
    decision: "HOLD",
    confidence: 90,
    comment,
    managementAction: "BREAKEVEN_NOTIFY",
  };
}


export function resolveOpenPositionDecision(
  position: Pick<OpenPosition, "direction" | "entry" | "stopLoss" | "takeProfit1">,
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
  const entry = parsePrice(position.entry);
  if (stopLoss === null || takeProfit1 === null || entry === null) {
    return buildHoldDecision("Dữ liệu SL/TP không hợp lệ, giữ vị thế.");
  }

  if (position.direction === "LONG") {
    if (stats.low <= stopLoss) {
      return buildStopDecision(`Giá thấp nhất ${formatPrice(stats.low)} đã chạm stop loss ${formatPrice(stopLoss)}.`);
    }

    if (stats.high >= takeProfit1) {
      return buildCloseDecision(`Giá cao nhất ${formatPrice(stats.high)} đã chạm TP ${formatPrice(takeProfit1)}.`);
    }
  } else {
    if (stats.high >= stopLoss) {
      return buildStopDecision(`Giá cao nhất ${formatPrice(stats.high)} đã chạm stop loss ${formatPrice(stopLoss)}.`);
    }

    if (stats.low <= takeProfit1) {
      return buildCloseDecision(`Giá thấp nhất ${formatPrice(stats.low)} đã chạm TP ${formatPrice(takeProfit1)}.`);
    }
  }

  if (emaContext) {
    const emaDecision = resolveEmaExitDecision(position.direction, emaContext.lastClose, emaContext.emaValue, emaContext.period);
    if (emaDecision) return emaDecision;
  }

  const alreadyAtBreakeven = Math.abs(entry - stopLoss) < 1e-9;
  if (!alreadyAtBreakeven) {
    const oneRLevel = 2 * entry - stopLoss;
    const reached1R =
      position.direction === "LONG" ? stats.high >= oneRLevel : stats.low <= oneRLevel;
    if (reached1R) {
      return buildBreakevenDecision(
        `Giá đã đạt 1R (${formatPrice(oneRLevel)}) — dời SL về entry ${formatPrice(entry)}.`,
      );
    }
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
