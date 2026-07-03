import { extractNums } from "./lottery-format.js";
import type { LotteryDrawRecord, LotteryRegion } from "./lottery-types.js";
import { WEEKDAY_LABELS } from "./lottery-schedule.js";
import {
  callOpenRouter,
  type OpenRouterRequest,
} from "../shared/openrouter.js";
import { recordOpenRouterUsage } from "../shared/ai-usage.js";

export const PREDICTION_METHOD_VERSION = "digit-position-v1";

export type AiNumberPrediction = {
  number: string;
  confidence: number;
  reason: string;
  hundredsDigit: string;
  tensDigit: string;
  unitsDigit: string;
};

export type DigitPositionStats = {
  hundreds: Array<{ digit: string; count: number; ratio: number }>;
  tens: Array<{ digit: string; count: number; ratio: number }>;
  units: Array<{ digit: string; count: number; ratio: number }>;
};

const MODEL = process.env.AI_TEXT_MODEL?.trim() || "deepseek/deepseek-v4-pro";
const MAX_TOKENS = 8_000;

function cleanResponse(text: string): string {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function extractJsonObject(text: string): string {
  const cleaned = cleanResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function formatNums(nums: string[]): string {
  return nums.length > 0 ? nums.join(", ") : "-";
}

function compactHistoryLines(records: LotteryDrawRecord[]): string[] {
  return [...records]
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.province.localeCompare(right.province),
    )
    .map((record) => {
      const nums = [...extractNums(record.prizes)].sort();
      return `- ${record.date} | ${record.province} | ${formatNums(nums)}`;
    });
}

/** Đếm tần suất từng chữ số (0-9) riêng biệt cho mỗi hàng: trăm, chục, đơn vị. */
export function computeDigitPositionStats(
  records: LotteryDrawRecord[],
): DigitPositionStats {
  const hundreds = new Array(10).fill(0);
  const tens = new Array(10).fill(0);
  const units = new Array(10).fill(0);
  let total = 0;

  for (const record of records) {
    for (const num of extractNums(record.prizes)) {
      if (num.length < 3) continue;
      hundreds[parseInt(num[0], 10)]++;
      tens[parseInt(num[1], 10)]++;
      units[parseInt(num[2], 10)]++;
      total++;
    }
  }

  const toSortedArray = (counts: number[]) =>
    counts
      .map((count, digit) => ({
        digit: String(digit),
        count,
        ratio: total > 0 ? count / total : 0,
      }))
      .sort((a, b) => b.count - a.count || Number(a.digit) - Number(b.digit));

  return {
    hundreds: toSortedArray(hundreds),
    tens: toSortedArray(tens),
    units: toSortedArray(units),
  };
}

/** Tìm ratio của 1 digit trong mảng thống kê. */
function findRatio(
  entries: Array<{ digit: string; ratio: number }>,
  digit: string,
): number {
  return entries.find((e) => e.digit === digit)?.ratio ?? 0;
}

/** Tính confidence từ tỉ lệ thống kê thật của 3 digit — trung bình cộng 3 ratio. */
export function computeConfidence(
  stats: DigitPositionStats,
  hundredsDigit: string,
  tensDigit: string,
  unitsDigit: string,
): number {
  const h = findRatio(stats.hundreds, hundredsDigit);
  const t = findRatio(stats.tens, tensDigit);
  const u = findRatio(stats.units, unitsDigit);
  return (h + t + u) / 3;
}

function formatStatsLine(
  label: string,
  stats: Array<{ digit: string; count: number; ratio: number }>,
): string {
  const parts = stats.map(
    (s) => `${s.digit}=${s.count} lần (${(s.ratio * 100).toFixed(1)}%)`,
  );
  return `${label}: ${parts.join(", ")}`;
}

export function buildLotterySystemPrompt(region: LotteryRegion): string {
  const regionLabel =
    region === "mien-bac"
      ? "Miền Bắc"
      : region === "mien-trung"
        ? "Miền Trung"
        : "Miền Nam";

  return [
    "Bạn là chuyên gia phân tích thống kê xổ số Việt Nam và chỉ được dùng dữ liệu lịch sử được cung cấp.",
    `Khu vực cần phân tích: ${regionLabel}.`,
    "Miền Bắc có 1 đài mỗi ngày; Miền Trung và Miền Nam có nhiều đài quay mỗi ngày.",
    "",
    "QUAN TRỌNG — phương pháp phân tích:",
    "1. Bảng thống kê tần suất bên dưới (Thống kê tần suất theo từng hàng) đã được tính sẵn bằng code từ dữ liệu thật. DÙNG ĐÚNG số liệu này, KHÔNG tự suy đoán lại tần suất.",
    "2. PHẢI phân tích RIÊNG BIỆT xác suất của từng chữ số (0-9) cho 3 hàng: trăm, chục, đơn vị — dựa trên bảng thống kê tần suất được cung cấp.",
    "3. KHÔNG được thống kê/chọn theo tần suất của cả số 3 chữ số nguyên khối.",
    "4. Sau khi xác định chữ số có khả năng cao nhất (và các phương án khác nếu cần đủ topN) cho từng hàng, GHÉP 3 chữ số lại theo đúng thứ tự (trăm-chục-đơn vị) để tạo thành số dự đoán cuối cùng.",
    "5. Nếu cần nhiều số dự đoán khác nhau (topN > 1), hãy phối nhiều tổ hợp khác nhau từ các chữ số có xác suất cao/nhì/ba ở mỗi hàng — không ghi đúng 1 tổ hợp lặp lại.",
    "6. CẤM bịa số liệu tần suất ngoài bảng thống kê đã cung cấp.",
    "7. Không bịa số ngoài phạm vi 000-999.",
    'Trả về đúng JSON với schema: {"predictions":[{"number":"123","hundredsDigit":"1","tensDigit":"8","unitsDigit":"5","confidence":0.7,"reason":"Hàng trăm=1 (8.3%), hàng chục=8 (7.5%), hàng đơn vị=5 (6.2%)"}]}',
    "hundredsDigit/tensDigit/unitsDigit mỗi field là 1 ký tự số 0-9.",
    "confidence phải là số từ 0 đến 1.",
    "Nếu không đủ dữ liệu, vẫn trả số hợp lý nhất theo bảng thống kê nhưng không vượt phạm vi.",
    "Tất cả text bằng tiếng Việt có dấu, ngắn gọn, không markdown.",
  ].join("\n");
}

export function buildLotteryUserPrompt(
  records: LotteryDrawRecord[],
  stats: DigitPositionStats,
  region: LotteryRegion,
  weekday: number,
  topN: number,
): string {
  const weekdayLabel = WEEKDAY_LABELS[weekday] ?? `Thứ ${weekday + 1}`;
  const lines = compactHistoryLines(records);
  const statsBlock = [
    "Thống kê tần suất theo từng hàng (từ dữ liệu lịch sử thật, đã tính sẵn — dùng đúng số liệu này, không tự suy đoán lại):",
    formatStatsLine("Hàng trăm", stats.hundreds),
    formatStatsLine("Hàng chục", stats.tens),
    formatStatsLine("Hàng đơn vị", stats.units),
  ].join("\n");

  return [
    `Yêu cầu: dự đoán đúng ${topN} số cho ${weekdayLabel} của ${region}.`,
    "Dữ liệu lịch sử đã được rút gọn theo ngày và đài:",
    ...lines,
    "",
    statsBlock,
    "",
    "Chỉ trả JSON hợp lệ, không thêm giải thích ngoài JSON.",
    "Schema bắt buộc: { \"predictions\": [ { \"number\": \"185\", \"hundredsDigit\": \"1\", \"tensDigit\": \"8\", \"unitsDigit\": \"5\", \"confidence\": 0.62, \"reason\": \"Hàng trăm=1 (10.4%), hàng chục=8 (9.1%), hàng đơn vị=5 (8.7%)\" } ] }",
    `Số phải là chuỗi 3 chữ số (ghép từ hundredsDigit + tensDigit + unitsDigit). Trả đúng ${topN} dự đoán nếu có đủ dữ liệu; nếu không đủ thì trả ít hơn nhưng không được trả số sai định dạng.`,
  ].join("\n");
}

function normalizePredictions(
  raw: unknown,
  topN: number,
  stats: DigitPositionStats,
): AiNumberPrediction[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI response missing predictions object");
  }

  const entries = Array.isArray((raw as { predictions?: unknown }).predictions)
    ? (raw as { predictions: unknown[] }).predictions
    : [];

  const parsed: AiNumberPrediction[] = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;

    const hundredsDigitRaw = (item as { hundredsDigit?: unknown }).hundredsDigit;
    const tensDigitRaw = (item as { tensDigit?: unknown }).tensDigit;
    const unitsDigitRaw = (item as { unitsDigit?: unknown }).unitsDigit;
    const hundredsDigit = toText(hundredsDigitRaw);
    const tensDigit = toText(tensDigitRaw);
    const unitsDigit = toText(unitsDigitRaw);

    // Validate each digit is a single 0-9
    if (!/^\d$/.test(hundredsDigit)) continue;
    if (!/^\d$/.test(tensDigit)) continue;
    if (!/^\d$/.test(unitsDigit)) continue;

    // Reconstruct number from digits — trust code, not AI's "number" field
    const reconstructedNumber = hundredsDigit + tensDigit + unitsDigit;

    // Compute confidence from real stats — trust code, not AI's "confidence" field
    const confidence = computeConfidence(stats, hundredsDigit, tensDigit, unitsDigit);

    const reason = toText((item as { reason?: unknown }).reason);
    if (!reason) continue;

    parsed.push({
      number: reconstructedNumber,
      confidence,
      reason,
      hundredsDigit,
      tensDigit,
      unitsDigit,
    });
  }

  parsed.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.number.localeCompare(right.number),
  );

  const deduped: AiNumberPrediction[] = [];
  const seen = new Set<string>();
  for (const prediction of parsed) {
    if (seen.has(prediction.number)) continue;
    seen.add(prediction.number);
    deduped.push(prediction);
    if (deduped.length >= topN) break;
  }

  if (deduped.length === 0) {
    throw new Error("AI trả về 0 số hợp lệ");
  }

  return deduped.slice(0, topN);
}

export async function predictTopNumbersAI(
  records: LotteryDrawRecord[],
  region: LotteryRegion,
  weekday: number,
  topN = 10,
): Promise<AiNumberPrediction[]> {
  if (records.length === 0) {
    throw new Error("Không có dữ liệu lịch sử để dự đoán");
  }

  const stats = computeDigitPositionStats(records);

  const request: OpenRouterRequest = {
    model: MODEL,
    systemPrompt: buildLotterySystemPrompt(region),
    userContent: [
      {
        type: "text",
        text: buildLotteryUserPrompt(records, stats, region, weekday, topN),
      },
    ],
    maxTokens: MAX_TOKENS,
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    reasoning: { effort: "medium" },
  };

  const response = await callOpenRouter(request);
  void recordOpenRouterUsage(response, {
    model: MODEL,
    source: "lottery",
  });

  try {
    const parsed = JSON.parse(extractJsonObject(response.text)) as unknown;
    const predictions = normalizePredictions(parsed, topN, stats);
    return predictions.slice(0, topN);
  } catch (error) {
    throw new Error(
      `AI lottery prediction parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
