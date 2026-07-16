import { describe, expect, test } from "vitest";
import {
  REGION_URL_CODE,
  WEEKDAY_LABELS,
  weekdaySlug,
  weekdayPageUrl,
} from "../../src/lottery/service/lottery-schedule.js";
import type { LotteryRegion } from "../../src/lottery/lottery-types.js";

describe("lottery/lottery-schedule", () => {
  test("REGION_URL_CODE has correct 3 regions", () => {
    expect(REGION_URL_CODE["mien-bac"]).toBe("xsmb");
    expect(REGION_URL_CODE["mien-trung"]).toBe("xsmt");
    expect(REGION_URL_CODE["mien-nam"]).toBe("xsmn");
    // Ensure no extra keys beyond the 3 known regions
    expect(Object.keys(REGION_URL_CODE)).toHaveLength(3);
  });

  test("WEEKDAY_LABELS has correct 7 days", () => {
    // Verify the array matches source exactly — index 0..6 from Date#getDay()
    const expected = [
      "Chủ nhật",
      "Thứ 2",
      "Thứ 3",
      "Thứ 4",
      "Thứ 5",
      "Thứ 6",
      "Thứ 7",
    ] as const;
    expect(WEEKDAY_LABELS).toHaveLength(7);
    for (let i = 0; i < expected.length; i++) {
      expect(WEEKDAY_LABELS[i]).toBe(expected[i]);
    }
  });

  test("weekdaySlug returns correct slug for each weekday", () => {
    // weekday=0 is special: "chu-nhat-cn"; 1..6 → "thu-(weekday+1)"
    expect(weekdaySlug(0)).toBe("chu-nhat-cn");
    for (let wd = 1; wd <= 6; wd++) {
      expect(weekdaySlug(wd)).toBe(`thu-${wd + 1}`);
    }
  });

  test("weekdayPageUrl builds correct URL for mien-bac weekday=0", () => {
    const url = weekdayPageUrl("mien-bac" as LotteryRegion, 0);
    // xsmb + chu-nhat-cn
    expect(url).toBe("https://xoso.com.vn/xsmb-chu-nhat-cn.html");
  });

  test("weekdayPageUrl builds correct URL for mien-nam weekday=3", () => {
    const url = weekdayPageUrl("mien-nam" as LotteryRegion, 3);
    // xsmn + thu-4
    expect(url).toBe("https://xoso.com.vn/xsmn-thu-4.html");
  });
});