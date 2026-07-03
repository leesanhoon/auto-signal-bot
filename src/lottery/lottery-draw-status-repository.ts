import { getDb } from "../shared/db.js";
import type { LotteryRegion } from "./lottery-types.js";

/** Đọc cache "đã quay chưa" cho 1 ngày + miền. Trả null nếu chưa có cache hoặc lỗi DB. */
export async function loadDrawStatus(
  date: string,
  region: LotteryRegion,
): Promise<boolean | null> {
  try {
    const { data, error } = await (getDb().from("lottery_draw_status_cache") as any)
      .select("drawn")
      .eq("date", date)
      .eq("region", region)
      .maybeSingle();
    if (error || !data) return null;
    return data.drawn === true;
  } catch {
    return null;
  }
}

/** Lưu cache "đã quay" cho 1 ngày + miền (upsert). Chỉ gọi khi biết chắc đã có kết quả (drawn=true). */
export async function saveDrawStatus(
  date: string,
  region: LotteryRegion,
  drawn: boolean,
): Promise<void> {
  try {
    await (getDb().from("lottery_draw_status_cache") as any).upsert(
      { date, region, drawn, checked_at: new Date().toISOString() },
      { onConflict: "date,region" },
    );
  } catch {
    // Fail silently — không crash job vì lỗi cache
  }
}