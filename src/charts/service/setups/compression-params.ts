/**
 * Centralized compression parameters for all active Volman setups.
 *
 * Các giá trị window sizes và kBlock được backup-test validate — giữ nguyên.
 * Tài liệu này ghi rõ nguồn gốc và lý do mỗi setup dùng tham số khác.
 */

export const COMPRESSION_PARAMS = {
  /**
   * BB — Block Break
   * Window [10,8,6,5,4] (thứ tự GIẢM DẦN), kBlock=1.2.
   * Trend market, tight block near MA21, breakout in trend direction.
   * kBlock=1.2: phát hiện block chặt hơn (yêu cầu range nhỏ hơn).
   *
   * Thứ tự giảm dần là chủ đích: bb.ts lặp qua `windows` và dừng ở window
   * ĐẦU TIÊN thỏa `range <= kBlock * ATR`, nên đảo thứ tự này tương đương
   * "ưu tiên chọn window nhiều nến nhất (block/vùng nén rộng nhất) mà vẫn
   * còn thỏa điều kiện nén, fallback dần xuống window nhỏ hơn nếu không có
   * vùng nén rộng hơn". Window gốc 4-6 đã backup-test validate; 8 và 10 mở
   * rộng thêm để bắt vùng nén hình thành qua nhiều nến hơn — không đổi
   * kBlock để không nới lỏng tiêu chuẩn nén chỉ vì window lớn hơn.
   */
  BB: { windows: [10, 8, 6, 5, 4], kBlock: 1.2 },

  /**
   * RB — Range Break
   * Window [10,8,6], kBlock=2.0
   * Sideways market, larger range, multiple edge tests before real breakout.
   * kBlock=2.0: cho phép range rộng hơn để phát hiện range lớn.
   */
  RB: { windows: [10, 8, 6], kBlock: 2.0 },

  /**
   * IRB — Inside Range Break
   * Inner: Window [4,6], kBlock=1.5 — chặt hơn RB nhưng lỏng hơn BB
   * Outer: Window [10,15], kBlock=2.5 — rộng nhất, chứa inner range
   * IRB inner break phải breakout outer cùng lúc → tight inner đáng kể.
   */
  IRB_INNER: { windows: [4, 6], kBlock: 1.5 },
  IRB_OUTER: { windows: [10, 15], kBlock: 2.5 },

  /**
   * ARB — Advanced Range Break
   * Window [10,8,6], kBlock=2.0 (same as RB)
   * Range with ≥2 failed edge tests before real breakout.
   * Yêu cầu quality cao → tight range indicator tin cậy cao.
   */
  ARB: { windows: [10, 8, 6], kBlock: 2.0 },
} as const;
