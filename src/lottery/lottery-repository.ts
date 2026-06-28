import { getDb } from "../shared/db.js";
import type { LotteryDrawRecord } from "./lottery-types.js";

/** Giữ lịch sử 3 năm để đủ mẫu cho thống kê, không quá phình theo thời gian. */
const HISTORY_RETENTION_DAYS = 1095;

/** "YYYY-MM-DD" của lần gửi Telegram gần nhất, hoặc null nếu chưa từng gửi. */
export async function getLastSentDate(): Promise<string | null> {
  const { data, error } = await (getDb().from("lottery_last_sent") as any)
    .select("date_str")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  return data.date_str as string;
}

export async function setLastSentDate(dateStr: string): Promise<void> {
  const { error } = await (getDb().from("lottery_last_sent") as any).upsert({ id: 1, date_str: dateStr });
  if (error) throw new Error(`setLastSentDate failed: ${error.message}`);
}

/** Đọc toàn bộ lịch sử (cả 3 miền) của đúng 1 thứ trong tuần. */
export async function loadWeekdayHistory(weekday: number): Promise<LotteryDrawRecord[]> {
  const { data, error } = await (getDb().from("lottery_draws") as any).select("date, weekday, region, province, prizes").eq("weekday", weekday);
  if (error || !data) return [];
  return data as LotteryDrawRecord[];
}

/**
 * Upsert bản ghi mới (dedup theo primary key date+region+province nhờ Postgres), rồi prune
 * bản ghi quá cũ của ĐÚNG thứ tương ứng. `weekday` của các bản ghi phải khớp tham số `weekday`
 * — caller chịu trách nhiệm tách đúng nhóm trước khi gọi.
 */
export async function appendWeekdayHistory(weekday: number, newRecords: LotteryDrawRecord[], now: number = Date.now()): Promise<void> {
  if (newRecords.length === 0) return;

  const { error: upsertError } = await (getDb().from("lottery_draws") as any).upsert(newRecords, {
    onConflict: "date,region,province",
  });
  if (upsertError) throw new Error(`appendWeekdayHistory upsert failed: ${upsertError.message}`);

  const cutoff = new Date(now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { error: pruneError } = await (getDb().from("lottery_draws") as any).delete().eq("weekday", weekday).lt("date", cutoff);
  if (pruneError) throw new Error(`appendWeekdayHistory prune failed: ${pruneError.message}`);
}
