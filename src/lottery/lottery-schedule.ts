import type { LotteryRegion } from "./model/lottery-types.js";

/** Mã miền dùng trong URL xoso.com.vn (xsmb/xsmt/xsmn). */
export const REGION_URL_CODE: Record<LotteryRegion, string> = {
  "mien-bac": "xsmb",
  "mien-trung": "xsmt",
  "mien-nam": "xsmn",
};

/** Tên các thứ để hiển thị/đặt tên file, index trùng Date#getDay() (0=Chủ nhật..6=Thứ 7). */
export const WEEKDAY_LABELS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

/** Slug "theo thứ" của xoso.com.vn cho từng weekday — dùng để build URL trang tổng hợp nhiều tuần. */
export function weekdaySlug(weekday: number): string {
  return weekday === 0 ? "chu-nhat-cn" : `thu-${weekday + 1}`;
}

/** URL trang tổng hợp kết quả nhiều tuần gần nhất, đúng 1 miền + đúng 1 thứ. */
export function weekdayPageUrl(region: LotteryRegion, weekday: number): string {
  return `https://xoso.com.vn/${REGION_URL_CODE[region]}-${weekdaySlug(weekday)}.html`;
}
