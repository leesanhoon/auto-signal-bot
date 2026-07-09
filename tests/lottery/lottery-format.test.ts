import { describe, it, expect } from "vitest";
import { extractNums, extractNums2, matchPrizeLabel, matchPrizeLabelLast2 } from "../../src/lottery/lottery-format.js";
import type { CompactPrizes } from "../../src/lottery/lottery-types.js";

describe("lottery-format.ts", () => {
  describe("extractNums", () => {
    it("should extract 3-digit numbers from prizes, taking last 3 digits", () => {
      const prizes: CompactPrizes = {
        db: "00123",
        g1: "00456",
        g2: ["00789"],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const nums = extractNums(prizes);

      expect(nums).toContain("123");
      expect(nums).toContain("456");
      expect(nums).toContain("789");
    });

    it("should deduplicate numbers", () => {
      const prizes: CompactPrizes = {
        db: "00123",
        g1: "00123", // same as db
        g2: ["00123"], // same as db
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const nums = extractNums(prizes);

      expect(nums).toHaveLength(1);
      expect(nums[0]).toBe("123");
    });

    it("should skip numbers shorter than 3 digits", () => {
      const prizes: CompactPrizes = {
        db: "12", // 2 digits - skipped
        g1: "456", // 3 digits - included
        g2: ["7"], // 1 digit - skipped
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const nums = extractNums(prizes);

      expect(nums).not.toContain("12");
      expect(nums).toContain("456");
      expect(nums).not.toContain("7");
    });

    it("should handle empty prizes", () => {
      const prizes: CompactPrizes = {
        db: "",
        g1: "",
        g2: [],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const nums = extractNums(prizes);

      expect(nums).toEqual([]);
    });

    it("should handle multiple g2-g7 values", () => {
      const prizes: CompactPrizes = {
        db: "",
        g1: "",
        g2: ["00111", "00222"],
        g3: ["00333"],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const nums = extractNums(prizes);

      expect(nums).toContain("111");
      expect(nums).toContain("222");
      expect(nums).toContain("333");
    });
  });

  describe("matchPrizeLabel", () => {
    it("should match giải đặc biệt", () => {
      const prizes: CompactPrizes = {
        db: "00123",
        g1: "00456",
        g2: [],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const label = matchPrizeLabel(prizes, "123");

      expect(label).toBe("Giải đặc biệt");
    });

    it("should match giải nhất", () => {
      const prizes: CompactPrizes = {
        db: "",
        g1: "00456",
        g2: [],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const label = matchPrizeLabel(prizes, "456");

      expect(label).toBe("Giải nhất");
    });

    it("should match giải nhì (g2)", () => {
      const prizes: CompactPrizes = {
        db: "",
        g1: "",
        g2: ["00789"],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const label = matchPrizeLabel(prizes, "789");

      expect(label).toBe("Giải nhì");
    });

    it("should match giải ba through giải bảy", () => {
      const testCases = [
        (prizes: CompactPrizes) => matchPrizeLabel(prizes, "111"),
        (prizes: CompactPrizes) => matchPrizeLabel(prizes, "222"),
        (prizes: CompactPrizes) => matchPrizeLabel(prizes, "333"),
        (prizes: CompactPrizes) => matchPrizeLabel(prizes, "444"),
        (prizes: CompactPrizes) => matchPrizeLabel(prizes, "555"),
        (prizes: CompactPrizes) => matchPrizeLabel(prizes, "666"),
      ];

      const prizes: CompactPrizes = {
        db: "",
        g1: "",
        g2: ["00111"],
        g3: ["00222"],
        g4: ["00333"],
        g5: ["00444"],
        g6: ["00555"],
        g7: ["00666"],
        g8: [],
      };

      expect(matchPrizeLabel(prizes, "111")).toBe("Giải nhì");
      expect(matchPrizeLabel(prizes, "222")).toBe("Giải ba");
      expect(matchPrizeLabel(prizes, "333")).toBe("Giải tư");
      expect(matchPrizeLabel(prizes, "444")).toBe("Giải năm");
      expect(matchPrizeLabel(prizes, "555")).toBe("Giải sáu");
      expect(matchPrizeLabel(prizes, "666")).toBe("Giải bảy");
    });

    it("should return undefined for unmatched number", () => {
      const prizes: CompactPrizes = {
        db: "00123",
        g1: "00456",
        g2: [],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const label = matchPrizeLabel(prizes, "999");

      expect(label).toBeUndefined();
    });

    it("should handle numbers with leading zeros correctly", () => {
      const prizes: CompactPrizes = {
        db: "00005",
        g1: "",
        g2: [],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const label = matchPrizeLabel(prizes, "005");

      expect(label).toBe("Giải đặc biệt");
    });

    it("should skip numbers shorter than 3 digits in prizes", () => {
      const prizes: CompactPrizes = {
        db: "12", // 2 digits
        g1: "",
        g2: [],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      const label = matchPrizeLabel(prizes, "12");

      expect(label).toBeUndefined();
    });

    it("should handle multiple values in same prize group", () => {
      const prizes: CompactPrizes = {
        db: "",
        g1: "",
        g2: ["00111", "00222", "00333"],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: [],
      };

      expect(matchPrizeLabel(prizes, "111")).toBe("Giải nhì");
      expect(matchPrizeLabel(prizes, "222")).toBe("Giải nhì");
      expect(matchPrizeLabel(prizes, "333")).toBe("Giải nhì");
    });
  });
  describe("extractNums2", () => {
    it("should extract last 2 digits from prizes including g8 and deduplicate", () => {
      const prizes: CompactPrizes = {
        db: "00123",
        g1: "00423",
        g2: ["00789", "1"],
        g3: ["00890"],
        g4: [],
        g5: [],
        g6: [],
        g7: ["00901"],
        g8: ["23", "", "45"],
      };

      const nums = extractNums2(prizes);

      expect(nums).toEqual(["23", "89", "90", "01", "45"]);
    });

    it("should skip values shorter than 2 characters", () => {
      const prizes: CompactPrizes = {
        db: "9",
        g1: "",
        g2: ["1"],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: ["7"],
      };

      expect(extractNums2(prizes)).toEqual([]);
    });
  });

  describe("matchPrizeLabelLast2", () => {
    it("should match by last 2 digits including g8", () => {
      const prizes: CompactPrizes = {
        db: "00123",
        g1: "00456",
        g2: ["00789"],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: ["45"],
      };

      expect(matchPrizeLabelLast2(prizes, "923")).toBe("Giải đặc biệt");
      expect(matchPrizeLabelLast2(prizes, "845")).toBe("Giải tám");
    });

    it("should return undefined when no 2-digit match exists", () => {
      const prizes: CompactPrizes = {
        db: "00123",
        g1: "00456",
        g2: ["00789"],
        g3: [],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: ["45"],
      };

      expect(matchPrizeLabelLast2(prizes, "900")).toBeUndefined();
    });

    it("should respect label priority order for shared last 2 digits", () => {
      const prizes: CompactPrizes = {
        db: "",
        g1: "",
        g2: ["00123"],
        g3: ["99123"],
        g4: [],
        g5: [],
        g6: [],
        g7: [],
        g8: ["23"],
      };

      expect(matchPrizeLabelLast2(prizes, "123")).toBe("Giải nhì");
    });
  });
});
