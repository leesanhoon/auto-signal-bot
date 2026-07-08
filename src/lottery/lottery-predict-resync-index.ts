import "../shared/env.js";
import { getDb } from "../shared/db.js";
import { loadWeekdayHistory } from "./lottery-repository.js";
import { predictTopNumbersEnsemble } from "./lottery-ensemble-predict.js";
import { savePredictions } from "./lottery-predictions-repository.js";
import { sendMessage, notifyError } from "../shared/telegram.js";
import type { LotteryRegion } from "./lottery-types.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("lottery:lottery-predict-resync-index");
type PredictionGroup = {
  date: string;
  weekday: number;
  region: LotteryRegion;
  numbers: Set<string>;
};

function vnToday(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).toISOString().slice(0, 10);
}

function sameNumberSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const number of Array.from(left)) {
    if (!right.has(number)) return false;
  }
  return true;
}

function formatNumbers(numbers: Iterable<string>): string {
  return Array.from(numbers).join(", ");
}

async function sendResyncSummary(lines: string[]): Promise<void> {
  const header = "*Resync dự đoán*";
  if (lines.length === 0) {
    await sendMessage(`${header}\n\nKhông có dự đoán nào cần cập nhật. Rule mới đã khớp với dữ liệu đã lưu.`);
    return;
  }

  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > 3000) {
      if (current) chunks.push(current);
      current = line;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);

  for (let i = 0; i < chunks.length; i++) {
    const suffix = chunks.length > 1 ? `\n\n(${i + 1}/${chunks.length})` : "";
    await sendMessage(`${header}\n\n${chunks[i]}${suffix}`);
  }
}

async function main(): Promise<void> {
  const today = vnToday();
  logger.info(`Resync lottery predictions starting from ${today}`);

  const { data, error } = await (getDb().from("lottery_predictions") as any)
    .select("date, weekday, region, number")
    .is("verified_at", null)
    .gte("date", today)
    .order("date", { ascending: true })
    .order("region", { ascending: true })
    .order("rank", { ascending: true });
  if (error) throw new Error(`Query failed: ${error.message}`);

  const rows = (data ?? []) as Array<{
    date: string;
    weekday: number;
    region: LotteryRegion;
    number: string;
  }>;

  const groups = new Map<string, PredictionGroup>();
  for (const row of rows) {
    const key = `${row.date}|${row.region}`;
    const group = groups.get(key) ?? {
      date: row.date,
      weekday: row.weekday,
      region: row.region,
      numbers: new Set<string>(),
    };

    group.numbers.add(row.number);
    groups.set(key, group);
  }

  const historyCache = new Map<number, Awaited<ReturnType<typeof loadWeekdayHistory>>>();
  const historyForWeekday = async (weekday: number) => {
    const cached = historyCache.get(weekday);
    if (cached) return cached;
    const history = await loadWeekdayHistory(weekday);
    historyCache.set(weekday, history);
    return history;
  };

  const resynced: string[] = [];

  for (const group of Array.from(groups.values())) {
    const history = (await historyForWeekday(group.weekday)).filter((record) => record.region === group.region);
    if (history.length === 0) {
      logger.info(`Skip ${group.region} ${group.date}: no history for weekday ${group.weekday}`);
      continue;
    }

    try {
      const fresh = await predictTopNumbersEnsemble(history, group.region, group.weekday, 3);
      const freshNumbers = new Set(fresh.map((prediction) => prediction.number));
      if (sameNumberSet(group.numbers, freshNumbers)) {
        logger.info(`OK   ${group.region} ${group.date}: no change`);
        continue;
      }

      await savePredictions(group.date, group.weekday, group.region, fresh);
      resynced.push(
        `${group.region} ${group.date}: ${formatNumbers(group.numbers)} -> ${formatNumbers(freshNumbers)}`,
      );
      logger.info(`Update ${group.region} ${group.date}: ${formatNumbers(group.numbers)} -> ${formatNumbers(freshNumbers)}`);
    } catch (error) {
      logger.error(
        `Skip ${group.region} ${group.date}: algorithm prediction failed — ${error instanceof Error ? error.message : String(error)}`, 
      );
    }
  }

  if (resynced.length === 0) {
    logger.info("No predictions needed resync.");
  } else {
    logger.info(`Resynced ${resynced.length} prediction group(s).`);
  }

  await sendResyncSummary(
    resynced.length === 0
      ? []
      : [`Đã cập nhật ${resynced.length} nhóm dự đoán theo rule mới.`, "", ...resynced],
  );
}

main().catch(async (error) => {
  logger.error("Fatal error:", error);
  await notifyError("Lottery Predict Resync", error);
  process.exit(1);
});


