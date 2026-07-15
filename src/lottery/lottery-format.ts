import type { CompactPrizes, LotteryDrawRecord, LotteryRegion } from "./model/lottery-types.js";

/** Mã viết tắt cho các đài đã biết — ưu tiên tra map này trước khi fallback sang thuật toán. */
const PROVINCE_CODE: Record<string, string> = {
  "Miền Bắc": "MB",
  "TP.HCM": "HCM",
  "Đồng Tháp": "DT",
  "Cà Mau": "CM",
  "Bến Tre": "BT",
  "Vũng Tàu": "VT",
  "Bạc Liêu": "BL",
  "Đồng Nai": "DN",
  "Cần Thơ": "CT",
  "Sóc Trăng": "ST",
  "Tây Ninh": "TN",
  "An Giang": "AG",
  "Bình Thuận": "BTH",
  "Vĩnh Long": "VL",
  "Bình Dương": "BD",
  "Trà Vinh": "TV",
  "Long An": "LA",
  "Bình Phước": "BP",
  "Hậu Giang": "HG",
  "Tiền Giang": "TG",
  "Kiên Giang": "KG",
  "Đà Lạt": "DL",
  "Huế": "HUE",
  "Thừa Thiên Huế": "HUE",
  "Phú Yên": "PY",
  "Đắc Lắc": "DL2",
  "Đắk Lắk": "DL2",
  "Quảng Nam": "QNA",
  "Khánh Hòa": "KH",
  "Đà Nẵng": "DNG",
  "Bình Định": "BDI",
  "Quảng Trị": "QT",
  "Quảng Bình": "QB",
  "Gia Lai": "GL",
  "Ninh Thuận": "NT",
  "Quảng Ngãi": "QNG",
  "Kon Tum": "KT",
};

/** Biến thể viết tắt/không dấu cách hay gặp ngoài tên đầy đủ trong `PROVINCE_CODE`. */
const PROVINCE_CODE_ALIASES: Record<string, string> = {
  "TPHCM": "HCM",
  "HCM": "HCM",
  "TP HCM": "HCM",
  "HoChiMinh": "HCM",
  "Ho Chi Minh": "HCM",
};

const DIACRITICS_MAP: [RegExp, string][] = [
  [/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a"],
  [/[èéẹẻẽêềếệểễ]/g, "e"],
  [/[ìíịỉĩ]/g, "i"],
  [/[òóọỏõôồốộổỗơờớợởỡ]/g, "o"],
  [/[ùúụủũưừứựửữ]/g, "u"],
  [/[ỳýỵỷỹ]/g, "y"],
  [/đ/g, "d"],
];

function stripDiacritics(value: string): string {
  let result = value.toLowerCase();
  for (const [pattern, replacement] of DIACRITICS_MAP) result = result.replace(pattern, replacement);
  return result;
}

/** Bỏ dấu + bỏ mọi khoảng trắng/dấu câu, dùng làm khoá tra cứu — chịu được biến thể viết
 * "TP.HCM" / "TPHCM" / "TP HCM" đều khớp về cùng 1 khoá "tphcm". */
function normalizeKey(value: string): string {
  return stripDiacritics(value).replace(/[^a-z0-9]/g, "");
}

const NORMALIZED_PROVINCE_CODE: Record<string, string> = {};
for (const [name, code] of [...Object.entries(PROVINCE_CODE), ...Object.entries(PROVINCE_CODE_ALIASES)]) {
  NORMALIZED_PROVINCE_CODE[normalizeKey(name)] = code;
}

/** Mã viết tắt 1 tỉnh/đài — tra map cố định trước (chịu được biến thể có/không dấu cách,
 * có/không dấu chấm), không có thì lấy chữ đầu mỗi từ. */
function abbreviateProvince(province: string): string {
  const known = NORMALIZED_PROVINCE_CODE[normalizeKey(province)];
  if (known) return known;

  const words = stripDiacritics(province)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const code = words.map((w) => w[0]).join("").toUpperCase();
  return code || stripDiacritics(province).toUpperCase();
}

/** Rút mỗi số về 3 chữ số cuối (lô), bỏ giải 8 (2 chữ số, không dùng được), loại trùng. */
export function extractNums(prizes: CompactPrizes): string[] {
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (raw.length < 3) return;
    seen.add(raw.slice(-3));
  };

  push(prizes.db);
  push(prizes.g1);
  for (const group of [prizes.g2, prizes.g3, prizes.g4, prizes.g5, prizes.g6, prizes.g7]) {
    group.forEach(push);
  }

  return [...seen];
}

const PRIZE_LABELS: [string, (p: CompactPrizes) => string[]][] = [
  ["Giải đặc biệt", (p) => [p.db]],
  ["Giải nhất", (p) => [p.g1]],
  ["Giải nhì", (p) => p.g2],
  ["Giải ba", (p) => p.g3],
  ["Giải tư", (p) => p.g4],
  ["Giải năm", (p) => p.g5],
  ["Giải sáu", (p) => p.g6],
  ["Giải bảy", (p) => p.g7],
];

/** Tìm tên giải mà `number` (3 chữ số) khớp trong `prizes`, theo cùng quy tắc lọc với `extractNums`. */
export function matchPrizeLabel(prizes: CompactPrizes, number: string): string | undefined {
  for (const [label, getValues] of PRIZE_LABELS) {
    for (const raw of getValues(prizes)) {
      if (raw.length >= 3 && raw.slice(-3) === number) return label;
    }
  }
  return undefined;
}

const PRIZE_LABELS_2DIGIT: [string, (p: CompactPrizes) => string[]][] = [
  ["Giải đặc biệt", (p) => [p.db]],
  ["Giải nhất", (p) => [p.g1]],
  ["Giải nhì", (p) => p.g2],
  ["Giải ba", (p) => p.g3],
  ["Giải tư", (p) => p.g4],
  ["Giải năm", (p) => p.g5],
  ["Giải sáu", (p) => p.g6],
  ["Giải bảy", (p) => p.g7],
  ["Giải tám", (p) => p.g8],
];

/** Rút mỗi số về 2 chữ số cuối (đầu đuôi), có tính cả giải tám (2 chữ số), loại trùng. */
export function extractNums2(prizes: CompactPrizes): string[] {
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (raw.length < 2) return;
    seen.add(raw.slice(-2));
  };

  push(prizes.db);
  push(prizes.g1);
  for (const group of [prizes.g2, prizes.g3, prizes.g4, prizes.g5, prizes.g6, prizes.g7, prizes.g8]) {
    group.forEach(push);
  }

  return [...seen];
}

/** Tìm tên giải mà 2 chữ số cuối của `number` khớp với 2 chữ số cuối của 1 giải bất kỳ trong `prizes` (bao gồm giải tám). */
export function matchPrizeLabelLast2(prizes: CompactPrizes, number: string): string | undefined {
  const last2 = number.slice(-2);
  for (const [label, getValues] of PRIZE_LABELS_2DIGIT) {
    for (const raw of getValues(prizes)) {
      if (raw.length >= 2 && raw.slice(-2) === last2) return label;
    }
  }
  return undefined;
}

export type OptimizedLotteryStation = {
  /** Mã viết tắt tỉnh/đài. */
  p: string;
  /** Tất cả số lô 3 chữ số trong kỳ (đã loại trùng), gồm cả `db`. */
  n: string[];
  /** Giải đặc biệt (3 chữ số cuối), tách riêng để tiện tra cứu. */
  db: string;
};

/** Dataset rút gọn tối đa: group theo ngày, mỗi ngày là list các đài. */
export type OptimizedLotteryDataset = Record<string, OptimizedLotteryStation[]>;

/** Đóng gói dataset đúng-thứ-hôm-nay, riêng cho 1 miền, theo format rút gọn (OPT3). */
export function buildLotteryDataset(weekday: number, region: LotteryRegion, records: LotteryDrawRecord[]): OptimizedLotteryDataset {
  const dataset: OptimizedLotteryDataset = {};

  for (const record of records) {
    const station: OptimizedLotteryStation = {
      p: abbreviateProvince(record.province),
      n: extractNums(record.prizes),
      db: record.prizes.db.length >= 3 ? record.prizes.db.slice(-3) : record.prizes.db,
    };
    (dataset[record.date] ??= []).push(station);
  }

  return dataset;
}

export function lotteryFilename(weekday: number, dateStr: string, region: LotteryRegion): string {
  const [y, m, d] = dateStr.split("-");
  const label = weekday === 0 ? "cn" : `thu-${weekday + 1}`;
  return `${label}_${d}-${m}-${y}_${region}.json`;
}
