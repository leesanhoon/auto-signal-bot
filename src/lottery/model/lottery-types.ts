export type LotteryRegion = "mien-bac" | "mien-trung" | "mien-nam";

/** Tên tỉnh/đài như API trả về (ví dụ "TP.HCM", "Đồng Tháp", "Cà Mau"). */
export type ProvinceName = string;

/**
 * Bộ giải đã rút gọn, chỉ giữ số — không giữ text mô tả ("Giải đặc biệt", ...)
 * để tiết kiệm token khi gửi cho bộ phân tích đọc.
 */
export type CompactPrizes = {
  /** Giải đặc biệt. */
  db: string;
  /** Giải nhất. */
  g1: string;
  /** Giải nhì (có thể nhiều số với miền Nam/Trung). */
  g2: string[];
  /** Giải ba. */
  g3: string[];
  /** Giải tư. */
  g4: string[];
  /** Giải năm. */
  g5: string[];
  /** Giải sáu. */
  g6: string[];
  /** Giải bảy. */
  g7: string[];
  /** Giải tám (miền Nam/Trung) — miền Bắc không có, để rỗng. */
  g8: string[];
};

/** 1 bản ghi kết quả xổ số của 1 đài, 1 ngày — đơn vị lưu trong cache tích lũy. */
export type LotteryDrawRecord = {
  /** "YYYY-MM-DD" (giờ Asia/Ho_Chi_Minh). */
  date: string;
  /** 0=Chủ nhật .. 6=Thứ 7 (theo Date#getDay() trên giờ VN). */
  weekday: number;
  region: LotteryRegion;
  province: ProvinceName;
  prizes: CompactPrizes;
};

export type LotteryHistoryFile = {
  records: LotteryDrawRecord[];
};
