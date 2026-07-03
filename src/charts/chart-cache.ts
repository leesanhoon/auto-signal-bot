/**
 * Helper tính "candle H4 key" dạng YYYY-MM-DDTHH (làm tròn xuống mốc H4 gần nhất).
 * Khớp lịch cron trong .github/workflows/analyze.yml: 5 0,4,8,12,16,20 * * 1-5 (UTC).
 * Mỗi nến H4 đóng cửa tại 0, 4, 8, 12, 16, 20h UTC — key dùng chính giờ đó.
 */
export function getCurrentH4CandleCloseKey(now: Date = new Date()): string {
  const utcHours = now.getUTCHours();
  const clampedHour = Math.floor(utcHours / 4) * 4; // 0, 4, 8, 12, 16, 20
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(clampedHour).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}`;
}

/**
 * Kiểm tra xem thời điểm hiện tại có nằm trong cửa sổ windowMs sau khi nến H4 đóng cửa hay không.
 * Dùng để quyết định có nên chạy capture+AI (chỉ chạy trong cửa sổ ngắn sau nến đóng).
 */
export function isWithinCandleCloseWindow(now: Date, windowMs: number): boolean {
  const utcHours = now.getUTCHours();
  const clampedHour = Math.floor(utcHours / 4) * 4; // 0, 4, 8, 12, 16, 20
  const candleCloseTime = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      clampedHour,
      0, 0, 0,
    ),
  );
  const diff = now.getTime() - candleCloseTime.getTime();
  return diff >= 0 && diff < windowMs;
}
