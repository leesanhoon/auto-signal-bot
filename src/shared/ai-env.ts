const VALID_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof VALID_EFFORTS)[number];

/**
 * Đọc 1 biến env chung AI_REASONING_EFFORT, dùng cho mọi request AI có reasoning (betting + chart).
 * Nếu không set hoặc giá trị không hợp lệ → dùng fallback truyền vào.
 */
export function getConfiguredReasoningEffort(fallback: ReasoningEffort): ReasoningEffort {
  const raw = process.env.AI_REASONING_EFFORT?.trim();
  if (!raw) return fallback;
  if ((VALID_EFFORTS as readonly string[]).includes(raw)) return raw as ReasoningEffort;
  return fallback;
}
