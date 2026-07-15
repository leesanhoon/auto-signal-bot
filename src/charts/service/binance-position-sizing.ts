import type { BinanceSymbolFilters } from "../client/binance-futures-client.js";

export type PositionSizingInput = {
  balanceUsdt: number;
  riskPercent: number;
  // Neu co gia tri, dung so USDT co dinh nay lam risk moi lenh thay vi tinh
  // theo riskPercent * balanceUsdt (phu hop von nho, risk khong doi theo balance).
  riskUsdt?: number;
  entry: number;
  stopLoss: number;
  leverage: number;
  filters: BinanceSymbolFilters;
};

export type PositionSizingResult = {
  quantity: number;
  notional: number;
  marginRequired: number;
};

function decimalsOf(step: number): number {
  return step.toString().split(".")[1]?.length ?? 0;
}

function roundDownToStep(value: number, stepSize: number): number {
  if (!(stepSize > 0)) return value;
  const steps = Math.floor(value / stepSize);
  const rounded = steps * stepSize;
  // Tránh sai số float (vd 0.1 + 0.2), làm tròn về số chữ số thập phân của stepSize
  return Number(rounded.toFixed(decimalsOf(stepSize)));
}

// Làm tròn giá về bội số gần nhất của tickSize. BẮT BUỘC dùng cho mọi stopPrice
// gửi lên Binance (SL/TP) — giá không khớp tickSize bị từ chối (lỗi price precision).
export function roundToTickSize(price: number, tickSize: number): number {
  if (!(tickSize > 0) || !Number.isFinite(price)) return price;
  const rounded = Math.round(price / tickSize) * tickSize;
  return Number(rounded.toFixed(decimalsOf(tickSize)));
}

export function computeOrderQuantity(
  input: PositionSizingInput,
): PositionSizingResult | Error {
  const { balanceUsdt, riskPercent, riskUsdt: fixedRiskUsdt, entry, stopLoss, leverage, filters } = input;

  if (!(balanceUsdt > 0)) {
    return new Error("Balance USDT khong hop le (<= 0)");
  }
  if (fixedRiskUsdt === undefined && !(riskPercent > 0)) {
    return new Error("Risk percent khong hop le (<= 0)");
  }
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss)) {
    return new Error("Entry/stopLoss khong hop le");
  }

  const riskDistance = Math.abs(entry - stopLoss);
  if (riskDistance <= 0) {
    return new Error("Khoang cach entry-stopLoss bang 0, khong the tinh size");
  }

  const riskUsdt =
    fixedRiskUsdt !== undefined ? fixedRiskUsdt : (balanceUsdt * riskPercent) / 100;
  const rawQuantity = riskUsdt / riskDistance;
  const quantity = roundDownToStep(rawQuantity, filters.stepSize);

  if (quantity <= 0 || quantity < filters.minQty) {
    return new Error(
      `Quantity tinh duoc (${quantity}) nho hon minQty (${filters.minQty}) cua symbol — bo qua lenh nay`,
    );
  }

  const notional = quantity * entry;
  if (notional < filters.minNotional) {
    return new Error(
      `Notional (${notional.toFixed(2)} USDT) nho hon minNotional (${filters.minNotional}) cua symbol — bo qua lenh nay`,
    );
  }

  const marginRequired = notional / leverage;
  if (marginRequired > balanceUsdt) {
    return new Error(
      `Margin can (${marginRequired.toFixed(2)} USDT) vuot qua balance kha dung (${balanceUsdt.toFixed(2)} USDT)`,
    );
  }

  return { quantity, notional, marginRequired };
}

export type LeverageComputationInput = {
  notional: number;
  marginBudgetUsdt: number;
  maxLeverageForSymbol: number;
};

export type LeverageComputationResult = {
  leverage: number;
};

export function computeRequiredLeverage(
  input: LeverageComputationInput,
): LeverageComputationResult | Error {
  const { notional, marginBudgetUsdt, maxLeverageForSymbol } = input;

  if (!(notional > 0)) {
    return new Error("Notional khong hop le (<= 0)");
  }
  if (!(marginBudgetUsdt > 0)) {
    return new Error("Margin budget khong hop le (<= 0)");
  }
  if (!(maxLeverageForSymbol >= 1)) {
    return new Error("Max leverage cua symbol khong hop le");
  }

  const requiredLeverage = Math.ceil(notional / marginBudgetUsdt);
  const leverage = Math.max(1, requiredLeverage);

  if (leverage > maxLeverageForSymbol) {
    return new Error(
      `Can leverage ${leverage}x de vao lenh trong margin budget (${marginBudgetUsdt.toFixed(2)} USDT) nhung symbol chi cho phep toi da ${maxLeverageForSymbol}x — bo qua lenh nay`,
    );
  }

  return { leverage };
}

export function computeEquityCurveMultiplier(
  outcomes: Array<"win" | "loss" | "breakeven">,
  streakCount: number,
  winMultiplier: number,
  lossMultiplier: number,
): number {
  const SAFETY_MIN = 0.1;
  const SAFETY_MAX = 4;
  const clamp = (v: number) => Math.max(SAFETY_MIN, Math.min(SAFETY_MAX, v));

  if (outcomes.length < streakCount) return 1;

  const recent = outcomes.slice(0, streakCount);
  if (recent.every((o) => o === "win")) return clamp(winMultiplier);
  if (recent.every((o) => o === "loss")) return clamp(lossMultiplier);
  return 1;
}
