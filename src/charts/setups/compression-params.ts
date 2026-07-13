/**
 * Centralized compression parameters for all active Volman setups.
 *
 * Các giá trị window sizes và kBlock được backup-test validate — giữ nguyên.
 * Tài liệu này ghi rõ nguồn gốc và lý do mỗi setup dùng tham số khác.
 */

export const COMPRESSION_PARAMS = {
  /**
   * BB — Block Break
   * Window [4,5,6], kBlock=1.2
   * Trend market, tight block near MA21, breakout in trend direction.
   * kBlock=1.2: phát hiện block chặt hơn (yêu cầu range nhỏ hơn).
   */
  BB: { windows: [4, 5, 6], kBlock: 1.2 },

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
