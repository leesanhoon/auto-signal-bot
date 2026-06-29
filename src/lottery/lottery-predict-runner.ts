import { loadWeekdayHistory } from "./lottery-repository.js";
import { predictTopNumbers } from "./lottery-predict.js";
import { savePredictions } from "./lottery-predictions-repository.js";
import { WEEKDAY_LABELS } from "./lottery-schedule.js";
import { sendMessage } from "../shared/telegram.js";
import type { LotteryRegion } from "./lottery-types.js";

const REGIONS: LotteryRegion[] = ["mien-nam", "mien-trung", "mien-bac"];
const REGION_LABELS: Record<LotteryRegion, string> = {
  "mien-bac": "🟦 Miền Bắc",
  "mien-trung": "🟨 Miền Trung",
  "mien-nam": "🟩 Miền Nam",
};

function vnToday(): { dateStr: string; weekday: number } {
  const vnNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return { dateStr: vnNow.toISOString().slice(0, 10), weekday: vnNow.getDay() };
}

function overdueIcon(overdueRatio: number): string {
  if (overdueRatio > 1.3) return "🔥";
  if (overdueRatio > 1) return "⏳";
  return "✨";
}

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

/** Phân tích thống kê + hồi quy tuyến tính trên lịch sử đúng-thứ-hôm-nay, dự đoán top 3 số dễ ra mỗi miền. */
export async function runLotteryPredict(): Promise<void> {
  const { dateStr, weekday } = vnToday();
  const weekdayLabel = WEEKDAY_LABELS[weekday];
  console.log(`🔮 Lottery Predictor — ${weekdayLabel} ${dateStr}\n`);

  const history = await loadWeekdayHistory(weekday);
  if (history.length === 0) {
    await sendMessage(`🔮 *DỰ ĐOÁN XỔ SỐ*\n📅 ${weekdayLabel}, ${dateStr}\n\n❌ Chưa có dữ liệu lịch sử cho ${weekdayLabel} — bỏ qua, không có gì để dự đoán.`);
    console.log("✓ Không có dữ liệu để dự đoán.");
    return;
  }

  const lines: string[] = [
    "🔮 *DỰ ĐOÁN XỔ SỐ*",
    `📅 ${weekdayLabel}, ${dateStr}`,
    "",
  ];

  for (const region of REGIONS) {
    const recordsForRegion = history.filter((r) => r.region === region);
    if (recordsForRegion.length === 0) continue;

    const periodCount = new Set(recordsForRegion.map((r) => r.date)).size;
    const predictions = predictTopNumbers(recordsForRegion, region, 3);
    await savePredictions(dateStr, weekday, region, predictions);

    lines.push("━━━━━━━━━━━━━━━");
    lines.push(`${REGION_LABELS[region]}`);
    lines.push(`_(${periodCount} kỳ ${weekdayLabel.toLowerCase()} đã thống kê)_`);
    lines.push("");
    predictions.forEach((p, i) => {
      const gapNote = p.gap > 0 ? `chưa ra lại sau ${p.gap} kỳ` : "vừa ra ở kỳ liền trước";
      lines.push(`${RANK_MEDAL[i] ?? "▫️"} \`${p.number}\`  —  ${(p.freq * 100).toFixed(1)}% xác suất  ${overdueIcon(p.overdueRatio)} _(${gapNote})_`);
    });
    lines.push("");
    console.log(`✓ [${region}] Top ${predictions.length} số dự đoán từ ${periodCount} kỳ.`);
  }

  lines.push("━━━━━━━━━━━━━━━");
  lines.push("⚠️ _Chỉ mang tính tham khảo thống kê, xổ số là ngẫu nhiên._");
  await sendMessage(lines.join("\n"));
  console.log("\n✅ Hoàn tất.");
}
