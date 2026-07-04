import { describe, it, expect, vi } from "vitest";
import { parseWeekdayPage } from "../../src/lottery/lottery-scraper.js";

vi.mock("../../src/lottery/lottery-schedule.js");

describe("lottery-scraper.ts", () => {
  describe("parseWeekdayPage - Miền Bắc", () => {
    it("should parse single station with all prizes", () => {
      const htmlFlat = `kqngay_05072026><table><td class=special-prize> 12345 </td><td class=prize1> 67890 </td><td class=prize2> 11111 </td><td class=prize7> 66666 </td></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-bac", 6);

      expect(records).toHaveLength(1);
      expect(records[0].date).toBe("2026-07-05");
      expect(records[0].prizes.db).toBe("12345");
      expect(records[0].prizes.g1).toBe("67890");
    });

    it("should return empty db when not drawn", () => {
      const htmlFlat = `kqngay_05072026><table><td class=prize1> 67890 </td></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-bac", 6);

      expect(records).toHaveLength(1);
      expect(records[0].prizes.db).toBe("");
      expect(records[0].prizes.g1).toBe("67890");
    });

    it("should parse multiple dates", () => {
      const htmlFlat = `kqngay_05072026><table><td class=special-prize> 11111 </td></table>kqngay_28062026><table><td class=special-prize> 33333 </td></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-bac", 6);

      expect(records).toHaveLength(2);
      expect(records[0].date).toBe("2026-07-05");
      expect(records[0].prizes.db).toBe("11111");
      expect(records[1].date).toBe("2026-06-28");
      expect(records[1].prizes.db).toBe("33333");
    });

    it("should deduplicate same date marker", () => {
      const htmlFlat = `kqngay_05072026><table><td class=special-prize> 11111 </td></table>kqngay_05072026><table><td class=special-prize> 99999 </td></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-bac", 6);

      expect(records).toHaveLength(1);
      expect(records[0].prizes.db).toBe("11111");
    });
  });

  describe("parseWeekdayPage - Miền Nam/Trung", () => {
    it("should parse multi-station with provinces", () => {
      const htmlFlat = `kqngay_05072026><table><h3><a title="Xổ số TP.HCM"><tbody><tr><th>ĐB</th><td>data-loto=12345</td></tr><tr><th>1</th><td>data-loto=67890</td></tr></tbody></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-nam", 6);

      expect(records).toHaveLength(1);
      expect(records[0].province).toBe("TP.HCM");
      expect(records[0].prizes.db).toBe("12345");
      expect(records[0].prizes.g1).toBe("67890");
    });

    it("should handle multiple provinces", () => {
      const htmlFlat = `kqngay_05072026><table><h3><a title="Xổ số TP.HCM"><h3><a title="Xổ số Bà Rịa"><tbody><tr><th>ĐB</th><td>data-loto=11111</td><td>data-loto=22222</td></tr></tbody></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-nam", 6);

      expect(records).toHaveLength(2);
      expect(records[0].province).toBe("TP.HCM");
      expect(records[1].province).toBe("Bà Rịa");
      expect(records[1].prizes.db).toBe("22222");
    });

    it("should skip when no provinces found", () => {
      const htmlFlat = `kqngay_05072026><table><tr><td>data-loto=12345</td></tr></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-nam", 6);

      expect(records).toHaveLength(0);
    });
  });

  describe("parseWeekdayPage - edge cases", () => {
    it("should return empty array for empty HTML", () => {
      const records = parseWeekdayPage("", "mien-bac", 6);
      expect(records).toEqual([]);
    });

    it("should skip block with missing </table>", () => {
      const htmlFlat = `kqngay_05072026><table><td class=special-prize> 12345 </td>`;

      const records = parseWeekdayPage(htmlFlat, "mien-bac", 6);

      expect(records).toHaveLength(0);
    });

    it("should ignore extra widget HTML outside table", () => {
      const htmlFlat = `kqngay_05072026><table><td class=special-prize> 12345 </td></table><div class=widget><td class=prize2> 99999 </td></div>`;

      const records = parseWeekdayPage(htmlFlat, "mien-bac", 6);

      expect(records).toHaveLength(1);
      expect(records[0].prizes.g2).toEqual([]);
    });

    it("should parse date correctly DDMMYYYY", () => {
      const htmlFlat = `kqngay_01012026><table><td class=special-prize> 12345 </td></table>`;

      const records = parseWeekdayPage(htmlFlat, "mien-bac", 3);

      expect(records).toHaveLength(1);
      expect(records[0].date).toBe("2026-01-01");
    });
  });
});
