import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  isBinanceHonorOrderTypeEnabledVolman,
  getConfiguredBinanceEntryOrderExpiryMinutes,
  getConfiguredBinanceWorkingType,
} from "../../src/charts/binance-futures-config-env.js";

describe("binance-futures-config-env — entry order type flags", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isBinanceHonorOrderTypeEnabledVolman()", () => {
    test("returns false when BINANCE_HONOR_ORDER_TYPE_VOLMAN is not set", () => {
      delete process.env.BINANCE_HONOR_ORDER_TYPE_VOLMAN;
      expect(isBinanceHonorOrderTypeEnabledVolman()).toBe(false);
    });

    test("returns false when BINANCE_HONOR_ORDER_TYPE_VOLMAN is 'false'", () => {
      process.env.BINANCE_HONOR_ORDER_TYPE_VOLMAN = "false";
      expect(isBinanceHonorOrderTypeEnabledVolman()).toBe(false);
    });

    test("returns true when BINANCE_HONOR_ORDER_TYPE_VOLMAN is 'true'", () => {
      process.env.BINANCE_HONOR_ORDER_TYPE_VOLMAN = "true";
      expect(isBinanceHonorOrderTypeEnabledVolman()).toBe(true);
    });

    test("returns true when BINANCE_HONOR_ORDER_TYPE_VOLMAN is '1'", () => {
      process.env.BINANCE_HONOR_ORDER_TYPE_VOLMAN = "1";
      expect(isBinanceHonorOrderTypeEnabledVolman()).toBe(true);
    });
  });

  describe("getConfiguredBinanceEntryOrderExpiryMinutes()", () => {
    test("returns 60 when BINANCE_ENTRY_ORDER_EXPIRY_MINUTES is not set", () => {
      delete process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES;
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(60);
    });

    test("returns 60 when BINANCE_ENTRY_ORDER_EXPIRY_MINUTES is empty", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(60);
    });

    test("returns parsed value when BINANCE_ENTRY_ORDER_EXPIRY_MINUTES is valid number", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "120";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(120);
    });

    test("returns 60 when BINANCE_ENTRY_ORDER_EXPIRY_MINUTES is 0", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "0";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(60);
    });

    test("returns 60 when BINANCE_ENTRY_ORDER_EXPIRY_MINUTES is negative", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "-1";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(60);
    });

    test("returns 60 when BINANCE_ENTRY_ORDER_EXPIRY_MINUTES is not a number", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "invalid";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(60);
    });

    test("ignores whitespace", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "  90  ";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(90);
    });

    test("supports small values like 1", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "1";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(1);
    });

    test("supports large values like 1440", () => {
      process.env.BINANCE_ENTRY_ORDER_EXPIRY_MINUTES = "1440";
      expect(getConfiguredBinanceEntryOrderExpiryMinutes()).toBe(1440);
    });
  });

  describe("getConfiguredBinanceWorkingType()", () => {
    test("returns undefined when BINANCE_WORKING_TYPE is not set", () => {
      delete process.env.BINANCE_WORKING_TYPE;
      expect(getConfiguredBinanceWorkingType()).toBeUndefined();
    });

    test("returns undefined when BINANCE_WORKING_TYPE is empty", () => {
      process.env.BINANCE_WORKING_TYPE = "";
      expect(getConfiguredBinanceWorkingType()).toBeUndefined();
    });

    test("returns 'MARK_PRICE' when BINANCE_WORKING_TYPE is 'mark_price'", () => {
      process.env.BINANCE_WORKING_TYPE = "mark_price";
      expect(getConfiguredBinanceWorkingType()).toBe("MARK_PRICE");
    });

    test("returns 'MARK_PRICE' when BINANCE_WORKING_TYPE is 'MARK_PRICE'", () => {
      process.env.BINANCE_WORKING_TYPE = "MARK_PRICE";
      expect(getConfiguredBinanceWorkingType()).toBe("MARK_PRICE");
    });

    test("returns 'CONTRACT_PRICE' when BINANCE_WORKING_TYPE is 'contract_price'", () => {
      process.env.BINANCE_WORKING_TYPE = "contract_price";
      expect(getConfiguredBinanceWorkingType()).toBe("CONTRACT_PRICE");
    });

    test("returns 'CONTRACT_PRICE' when BINANCE_WORKING_TYPE is 'CONTRACT_PRICE'", () => {
      process.env.BINANCE_WORKING_TYPE = "CONTRACT_PRICE";
      expect(getConfiguredBinanceWorkingType()).toBe("CONTRACT_PRICE");
    });

    test("returns undefined for invalid values", () => {
      process.env.BINANCE_WORKING_TYPE = "invalid";
      expect(getConfiguredBinanceWorkingType()).toBeUndefined();
    });

    test("ignores case and whitespace", () => {
      process.env.BINANCE_WORKING_TYPE = "  Mark_Price  ";
      expect(getConfiguredBinanceWorkingType()).toBe("MARK_PRICE");
    });
  });
});
