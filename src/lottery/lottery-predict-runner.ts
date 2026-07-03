import { fetchActualRecords } from "./lottery-scraper.js";
import { loadWeekdayHistory } from "./lottery-repository.js";
import { predictTopNumbersAI } from "./lottery-ai-predict.js";
import {
  loadCachedPredictions,
  savePredictions,
} from "./lottery-predictions-repository.js";
import { WEEKDAY_LABELS } from "./lottery-schedule.js";
import { sendMessage } from "../shared/telegram.js";
import type { LotteryRegion } from "./lottery-types.js";
import { createLogger } from "../shared/logger.js";
import type { AiNumberPrediction } from "./lottery-ai-predict.js";

const logger = createLogger("lottery:lottery-predict-runner");
const REGIONS: LotteryRegion[] = ["mien-nam", "mien-trung", "mien-bac"];
const REGION_LABELS: Record<LotteryRegion, string> = {
  "mien-bac": "🟦 Miền Bắc",
  "mien-trung": "🟨 Miền Trung",
  "mien-nam": "🟩 Miền Nam",
};
const MAX_REASON_LENGTH = 300;

type RegionPredictionResult = {
  region: LotteryRegion;
  target: { dateStr: string; weekday: number };
  weekdayLabel: string;
  periodCount: number;
  predictions: AiNumberPrediction[];
  usedCache: boolean;
};

/** Ngày/thứ ở offset ngày so với hôm nay, theo giờ Asia/Ho_Chi_Minh (cùng pattern đã dùng ở lottery-runner.ts). */
function vnDateOffset(offsetDays: number): {
  dateStr: string;
  weekday: number;
} {
  const vnNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }),
  );
  vnNow.setDate(vnNow.getDate() + offsetDays);
  return { dateStr: vnNow.toISOString().slice(0, 10), weekday: vnNow.getDay() };
}

/** Đã có kết quả thật hôm nay của miền này chưa — kiểm tra trực tiếp bằng scrape, không đoán theo giờ cố định
 * (giờ quay xong thực tế dao động mỗi ngày, đoán bằng giờ cố định dễ sai như đã gặp với Miền Nam). */
async function hasDrawnToday(
  region: LotteryRegion,
  dateStr: string,
  weekday: number,
): Promise<boolean> {
  try {
    const records = await fetchActualRecords(region, dateStr, weekday);
    return records.length > 0;
  } catch {
    return false;
  }
}

/** Ngày/thứ mục tiêu của 1 miền — nếu hôm nay miền đó đã có kết quả thật rồi thì dự đoán cho ngày mai. */
async function targetForRegion(
  region: LotteryRegion,
  today: { dateStr: string; weekday: number },
): Promise<{ dateStr: string; weekday: number }> {
  const alreadyDrawnToday = await hasDrawnToday(
    region,
    today.dateStr,
    today.weekday,
  );
  return alreadyDrawnToday ? vnDateOffset(1) : today;
}

function formatReason(reason: string): string {
  const compact = reason.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_REASON_LENGTH) return compact;
  return `${compact.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`;
}

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

/** Dự đoán AI top 3 số dễ ra mỗi miền — mỗi miền tự tính đúng ngày/thứ mục tiêu (hôm nay hoặc ngày mai nếu đã quay xong). */
export async function runLotteryPredict(): Promise<void> {
  const today = vnDateOffset(0);
  logger.info(
    `🔮 Lottery Predictor — chạy ngày ${today.dateStr} (${WEEKDAY_LABELS[today.weekday]})\n`,
  );

  const historyCache = new Map<number, ReturnType<typeof loadWeekdayHistory>>();
  const historyForWeekday = (weekday: number) => {
    let history = historyCache.get(weekday);
    if (!history) {
      history = loadWeekdayHistory(weekday);
      historyCache.set(weekday, history);
    }
    return history;
  };

  const lines: string[] = ["🔮 *DỰ ĐOÁN XỔ SỐ*", ""];
  const regionResults = await Promise.allSettled(
    REGIONS.map(async (region): Promise<RegionPredictionResult | null> => {
      const target = await targetForRegion(region, today);
      const weekdayLabel = WEEKDAY_LABELS[target.weekday];
      const history = await historyForWeekday(target.weekday);
      const recordsForRegion = history.filter((r) => r.region === region);
      if (recordsForRegion.length === 0) {
        logger.info(
          `✗ [${region}] Chưa có dữ liệu lịch sử cho ${weekdayLabel} — bỏ qua.`,
        );
        return null;
      }

      const periodCount = new Set(recordsForRegion.map((r) => r.date)).size;
      let cached: Awaited<ReturnType<typeof loadCachedPredictions>> = [];
      try {
        cached = await loadCachedPredictions(target.dateStr, region);
      } catch (error) {
        logger.error(
          `⚠ [${region}] Đọc cache lỗi, sẽ gọi AI: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (cached.length > 0) {
        const predictions = cached
          .filter((item) => item.number.length === 3)
          .map((item) => ({
            number: item.number,
            confidence: item.confidence,
            reason: item.reason,
            hundredsDigit: item.number[0],
            tensDigit: item.number[1],
            unitsDigit: item.number[2],
          }));
        if (predictions.length === 0) {
          logger.info(
            `✗ [${region}] Cache có dữ liệu nhưng số không hợp lệ (không đúng 3 chữ số) — sẽ gọi AI.`,
          );
        } else {
          logger.info(
            `↻ [${region}] Dùng lại dự đoán đã lưu cho ${target.dateStr} (bỏ qua gọi AI).`,
          );
          logger.info(
            `✓ [${region}] Top ${predictions.length} số dự đoán cho ${weekdayLabel} ${target.dateStr} từ ${periodCount} kỳ.`,
          );
          return {
            region,
            target,
            weekdayLabel,
            periodCount,
            predictions,
            usedCache: true,
          };
        }
      }

      try {
        const predictions = await predictTopNumbersAI(recordsForRegion, region, target.weekday, 3);
        await savePredictions(target.dateStr, target.weekday, region, predictions);
        logger.info(
          `✓ [${region}] Top ${predictions.length} số dự đoán cho ${weekdayLabel} ${target.dateStr} từ ${periodCount} kỳ.`,
        );
        return {
          region,
          target,
          weekdayLabel,
          periodCount,
          predictions,
          usedCache: false,
        };
      } catch (error) {
        logger.error(
          `✗ [${region}] AI dự đoán lỗi — bỏ qua miền này: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    }),
  );

  const resolvedResults: Array<RegionPredictionResult | null> = regionResults.map(
    (result, index) => {
      if (result.status === "fulfilled") return result.value;
      logger.error(
        `✗ [${REGIONS[index]}] AI dự đoán lỗi — bỏ qua miền này: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
      return null;
    },
  );

  let anyPrediction = false;
  for (const result of resolvedResults) {
    if (!result) continue;
    anyPrediction = true;

    lines.push("━━━━━━━━━━━━━━━");
    lines.push(`${REGION_LABELS[result.region]} — ${result.weekdayLabel}, ${result.target.dateStr}`);
    lines.push(
      `_(${result.periodCount} kỳ ${result.weekdayLabel.toLowerCase()} đã thống kê${result.usedCache ? ", dùng cache" : ""})_`,
    );
    lines.push("");
    result.predictions.forEach((p, i) => {
      lines.push(
        `${RANK_MEDAL[i] ?? "▫️"} \`${p.number}\` — ${(p.confidence * 100).toFixed(0)}% tin cậy _(${formatReason(p.reason)})_`,
      );
    });
    lines.push("");
  }

  if (!anyPrediction) {
    await sendMessage(
      "🔮 *DỰ ĐOÁN XỔ SỐ*\n\n❌ Chưa có dữ liệu lịch sử cho miền/ngày nào — bỏ qua.",
    );
    logger.info("✓ Không có dữ liệu để dự đoán.");
    return;
  }

  lines.push("━━━━━━━━━━━━━━━");
  lines.push("⚠️ _Chỉ mang tính tham khảo thống kê, xổ số là ngẫu nhiên._");
  await sendMessage(lines.join("\n"));
  logger.info("\n✅ Hoàn tất.");
}
