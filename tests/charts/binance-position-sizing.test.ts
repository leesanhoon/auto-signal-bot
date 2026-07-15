import { describe, it, expect } from "vitest";
import {
  computeOrderQuantity,
  roundToTickSize,
  computeRequiredLeverage,
  computeEquityCurveMultiplier,
  type PositionSizingInput,
  type LeverageComputationInput,
} from "../../src/charts/service/binance-position-sizing.js";

describe("charts/binance-position-sizing", () => {
  describe("computeOrderQuantity", () => {
    const defaultFilters: BinanceSymbolFilters = {
      stepSize: 0.001,
      minQty: 0.001,
      tickSize: 0.01,
      minNotional: 5,
    };

    it("calculates valid order quantity with proper rounding", () => {
      const input: PositionSizingInput = {
        balanceUsdt: 1000,
        riskPercent: 1,
        entry: 100,
        stopLoss: 98,
        leverage: 5,
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).not.toBeInstanceOf(Error);
      expect(result).toHaveProperty("quantity");
      expect(result).toHaveProperty("notional");
      expect(result).toHaveProperty("marginRequired");

      if (!(result instanceof Error)) {
        // riskDistance = |100 - 98| = 2
        // riskUsdt = 1000 * 1 / 100 = 10
        // rawQuantity = 10 / 2 = 5
        // quantity rounded down to stepSize 0.001 = 5.0
        expect(result.quantity).toBe(5.0);
        expect(result.notional).toBe(500);
        expect(result.marginRequired).toBe(100);
      }
    });

    it("returns error when risk distance is zero (entry === stopLoss)", () => {
      const input: PositionSizingInput = {
        balanceUsdt: 1000,
        riskPercent: 1,
        entry: 100,
        stopLoss: 100,
        leverage: 5,
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("bang 0");
    });

    it("returns error when calculated quantity is below minQty", () => {
      const input: PositionSizingInput = {
        balanceUsdt: 1,
        riskPercent: 0.1,
        entry: 100,
        stopLoss: 98,
        leverage: 5,
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("minQty");
    });

    it("returns error when notional is below minNotional", () => {
      const input: PositionSizingInput = {
        balanceUsdt: 1000,
        riskPercent: 0.001,
        entry: 100,
        stopLoss: 98,
        leverage: 5,
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("minNotional");
    });

    it("returns error when margin required exceeds balance", () => {
      const input: PositionSizingInput = {
        balanceUsdt: 10,
        riskPercent: 1,
        entry: 100,
        stopLoss: 99.5, // riskDistance = 0.5
        leverage: 1, // Very low leverage
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("vuot qua balance");
    });

    it("returns error when balance is invalid", () => {
      const input: PositionSizingInput = {
        balanceUsdt: -100,
        riskPercent: 1,
        entry: 100,
        stopLoss: 98,
        leverage: 5,
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).toBeInstanceOf(Error);
    });

    it("uses fixed riskUsdt instead of riskPercent when provided", () => {
      const input: PositionSizingInput = {
        balanceUsdt: 100,
        riskPercent: 1,
        riskUsdt: 10,
        entry: 100,
        stopLoss: 98,
        leverage: 5,
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).not.toBeInstanceOf(Error);

      if (!(result instanceof Error)) {
        // riskDistance = 2, riskUsdt fixed = 10 -> rawQuantity = 5
        expect(result.quantity).toBe(5.0);
      }
    });

    it("returns error when risk percent is invalid", () => {
      const input: PositionSizingInput = {
        balanceUsdt: 1000,
        riskPercent: 0,
        entry: 100,
        stopLoss: 98,
        leverage: 5,
        filters: defaultFilters,
      };

      const result = computeOrderQuantity(input);
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("roundToTickSize", () => {
    it("rounds price to nearest multiple of tickSize", () => {
      expect(roundToTickSize(64123.4567, 0.1)).toBe(64123.5);
    });

    it("handles small tickSize values", () => {
      expect(roundToTickSize(0.123456, 0.0001)).toBe(0.1235);
    });

    it("avoids floating point errors in result", () => {
      const result = roundToTickSize(1.005, 0.01);
      // Should be exactly 1.01 with 2 decimal places
      const decimalPlaces = String(result).split(".")[1]?.length ?? 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });

    it("returns original price when tickSize is invalid", () => {
      expect(roundToTickSize(100.5, 0)).toBe(100.5);
      expect(roundToTickSize(100.5, -0.1)).toBe(100.5);
    });

    it("returns original price when price is not finite", () => {
      expect(roundToTickSize(Infinity, 0.1)).toBe(Infinity);
      expect(roundToTickSize(NaN, 0.1)).toBe(NaN);
    });

    it("rounds to nearest tick for values in between", () => {
      // 1.034 / 0.01 = 103.4, Math.round(103.4) = 103, 103 * 0.01 = 1.03
      expect(roundToTickSize(1.034, 0.01)).toBe(1.03);
      // 1.036 / 0.01 = 103.6, Math.round(103.6) = 104, 104 * 0.01 = 1.04
      expect(roundToTickSize(1.036, 0.01)).toBe(1.04);
    });
  });

  describe("computeRequiredLeverage", () => {
    it("returns leverage 1 when notional is small relative to margin budget", () => {
      const input: LeverageComputationInput = {
        notional: 100,
        marginBudgetUsdt: 500,
        maxLeverageForSymbol: 20,
      };

      const result = computeRequiredLeverage(input);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        // ceil(100 / 500) = ceil(0.2) = 1, max(1, 1) = 1
        expect(result.leverage).toBe(1);
      }
    });

    it("calculates correct leverage when notional > margin budget", () => {
      const input: LeverageComputationInput = {
        notional: 1000,
        marginBudgetUsdt: 200,
        maxLeverageForSymbol: 20,
      };

      const result = computeRequiredLeverage(input);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        // ceil(1000 / 200) = ceil(5) = 5
        expect(result.leverage).toBe(5);
      }
    });

    it("calculates correct leverage with non-integer result", () => {
      const input: LeverageComputationInput = {
        notional: 1000,
        marginBudgetUsdt: 210,
        maxLeverageForSymbol: 20,
      };

      const result = computeRequiredLeverage(input);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        // ceil(1000 / 210) = ceil(4.76) = 5
        expect(result.leverage).toBe(5);
      }
    });

    it("returns error when leverage exceeds maxLeverage", () => {
      const input: LeverageComputationInput = {
        notional: 10000,
        marginBudgetUsdt: 100,
        maxLeverageForSymbol: 5,
      };

      const result = computeRequiredLeverage(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("100x");
    });

    it("returns error when notional is invalid", () => {
      const input: LeverageComputationInput = {
        notional: -100,
        marginBudgetUsdt: 200,
        maxLeverageForSymbol: 20,
      };

      const result = computeRequiredLeverage(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("Notional khong hop le");
    });

    it("returns error when margin budget is invalid", () => {
      const input: LeverageComputationInput = {
        notional: 1000,
        marginBudgetUsdt: 0,
        maxLeverageForSymbol: 20,
      };

      const result = computeRequiredLeverage(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("Margin budget khong hop le");
    });

    it("returns error when maxLeverage is invalid", () => {
      const input: LeverageComputationInput = {
        notional: 1000,
        marginBudgetUsdt: 200,
        maxLeverageForSymbol: 0.5,
      };

      const result = computeRequiredLeverage(input);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("Max leverage cua symbol khong hop le");
    });

    it("accepts maxLeverage = 1 as valid", () => {
      const input: LeverageComputationInput = {
        notional: 100,
        marginBudgetUsdt: 100,
        maxLeverageForSymbol: 1,
      };

      const result = computeRequiredLeverage(input);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.leverage).toBe(1);
      }
    });
  });

  describe("computeEquityCurveMultiplier", () => {
    it("returns 1 when outcomes length < streakCount", () => {
      const outcomes = ["win", "loss"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 3, 2, 0.25);
      expect(result).toBe(1);
    });

    it("returns winMultiplier when all N recent outcomes are 'win'", () => {
      const outcomes = ["win", "win", "loss", "win"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 0.25);
      expect(result).toBe(2);
    });

    it("returns lossMultiplier when all N recent outcomes are 'loss'", () => {
      const outcomes = ["loss", "loss", "win", "loss"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 0.25);
      expect(result).toBe(0.25);
    });

    it("returns 1 when outcomes are mixed (win and loss in first N)", () => {
      const outcomes = ["win", "loss", "win"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 0.25);
      expect(result).toBe(1);
    });

    it("returns 1 when 'breakeven' is in first N outcomes", () => {
      const outcomes = ["win", "breakeven", "loss"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 0.25);
      expect(result).toBe(1);
    });

    it("clamps winMultiplier to SAFETY_MAX (4) when configured value is too high", () => {
      const outcomes = ["win", "win"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 100, 0.25);
      expect(result).toBe(4);
    });

    it("clamps lossMultiplier to SAFETY_MIN (0.1) when configured value is too low", () => {
      const outcomes = ["loss", "loss"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 0.001);
      expect(result).toBe(0.1);
    });

    it("respects custom valid winMultiplier within clamp range", () => {
      const outcomes = ["win", "win", "win"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 3, 3.5, 0.25);
      expect(result).toBe(3.5);
    });

    it("respects custom valid lossMultiplier within clamp range", () => {
      const outcomes = ["loss", "loss"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 0.5);
      expect(result).toBe(0.5);
    });

    it("clamps lossMultiplier to SAFETY_MAX (4) if improperly configured high", () => {
      const outcomes = ["loss", "loss"] as const;
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 10);
      expect(result).toBe(4);
    });

    it("handles empty outcomes array", () => {
      const outcomes: Array<"win" | "loss" | "breakeven"> = [];
      const result = computeEquityCurveMultiplier(outcomes, 2, 2, 0.25);
      expect(result).toBe(1);
    });
  });

});
