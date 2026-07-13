import { describe, it, expect } from "vitest";
import {
  computeOrderQuantity,
  roundToTickSize,
  type PositionSizingInput,
  type BinanceSymbolFilters,
} from "../../src/charts/binance-position-sizing.js";

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

});
