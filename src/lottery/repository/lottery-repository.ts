import { getDb } from "../../shared/infra/db.js";
import type { LotteryDrawRecord, LotteryRegion } from "../model/lottery-types.js";

/** Giữ lịch sử 3 năm để đủ mẫu cho thống kê, không quá phình theo thời gian. */
const HISTORY_RETENTION_DAYS = 1095;

/** Đọc toàn bộ lịch sử (cả 3 miền) của đúng 1 thứ trong tuần. */
export async function loadWeekdayHistory(weekday: number): Promise<LotteryDrawRecord[]> {
  const allRecords: LotteryDrawRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  // Paginate through results using .range() to handle Supabase's 1000-row cap
  while (true) {
    const { data, error } = await (getDb().from("lottery_draws") as any)
      .select("date, weekday, region, province, prizes")
      .eq("weekday", weekday)
      .order("date", { ascending: true })
      .order("region", { ascending: true })
      .order("province", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`loadWeekdayHistory failed for weekday ${weekday}: ${error.message}`);
    if (!data || data.length === 0) break;

    allRecords.push(...data);

    // If we got fewer rows than requested, we've reached the end
    if (data.length < pageSize) break;

    offset += pageSize;
  }

  return allRecords as LotteryDrawRecord[];
}

/** Đọc toàn bộ lịch sử của 1 miền (mọi weekday) — dùng cho backtest, không giới hạn theo thứ. */
export async function loadRegionHistory(region: LotteryRegion): Promise<LotteryDrawRecord[]> {
  const allRecords: LotteryDrawRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  // Paginate through results using .range() to handle Supabase's 1000-row cap
  while (true) {
    const { data, error } = await (getDb().from("lottery_draws") as any)
      .select("date, weekday, region, province, prizes")
      .eq("region", region)
      .order("date", { ascending: true })
      .order("region", { ascending: true })
      .order("province", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`loadRegionHistory failed for region ${region}: ${error.message}`);
    if (!data || data.length === 0) break;

    allRecords.push(...data);

    // If we got fewer rows than requested, we've reached the end
    if (data.length < pageSize) break;

    offset += pageSize;
  }

  return allRecords as LotteryDrawRecord[];
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
