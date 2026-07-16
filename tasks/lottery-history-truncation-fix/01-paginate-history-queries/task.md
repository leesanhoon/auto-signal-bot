# Task 01 — Paginate history queries in lottery-repository.ts

## Bối cảnh (đọc kỹ trước khi làm)

File `src/lottery/repository/lottery-repository.ts` hiện tại (nguyên văn, dòng 1-42):

```ts
import { getDb } from "../../shared/infra/db.js";
import type { LotteryDrawRecord, LotteryRegion } from "../model/lottery-types.js";

/** Giữ lịch sử 3 năm để đủ mẫu cho thống kê, không quá phình theo thời gian. */
const HISTORY_RETENTION_DAYS = 1095;

/** Đọc toàn bộ lịch sử (cả 3 miền) của đúng 1 thứ trong tuần. */
export async function loadWeekdayHistory(weekday: number): Promise<LotteryDrawRecord[]> {
  const { data, error } = await (getDb().from("lottery_draws") as any).select("date, weekday, region, province, prizes").eq("weekday", weekday);
  if (error) throw new Error(`loadWeekdayHistory failed for weekday ${weekday}: ${error.message}`);
  if (!data) return [];
  return data as LotteryDrawRecord[];
}

/** Đọc toàn bộ lịch sử của 1 miền (mọi weekday) — dùng cho backtest, không giới hạn theo thứ. */
export async function loadRegionHistory(region: LotteryRegion): Promise<LotteryDrawRecord[]> {
  const { data, error } = await (getDb().from("lottery_draws") as any)
    .select("date, weekday, region, province, prizes")
    .eq("region", region);
  if (error) throw new Error(`loadRegionHistory failed for region ${region}: ${error.message}`);
  if (!data) return [];
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
```

## Bug đã verify

`loadWeekdayHistory` và `loadRegionHistory` không có `.order()` và không phân trang. Supabase/PostgREST mặc định cap **tối đa 1000 rows/request** (server-side, `.limit()` cao hơn cũng không vượt qua được). Dữ liệu thật trong bảng `lottery_draws` đã vượt cap này ở mọi query thực tế (weekday=4 cả 3 miền = 1097 rows; region=mien-bac = 1087, mien-trung = 2667, mien-nam = 3450). Vì không có `ORDER BY`, phần bị cắt rơi vào dữ liệu **mới nhất**, khiến predictor tính trên dữ liệu cũ hơn thực tế 1-2 tuần mà không hề biết.

## Yêu cầu implementation

Sửa **cả 2 hàm** `loadWeekdayHistory` và `loadRegionHistory` để lấy **toàn bộ** rows bằng cách phân trang qua `.range(from, to)`, lặp cho tới khi 1 trang trả về ít hơn page size (nghĩa là đã hết dữ liệu). Giữ nguyên page size 1000 (khớp cap mặc định của Supabase, không cần đổi cấu hình server).

Gợi ý cấu trúc (không bắt buộc đặt tên y hệt, nhưng PHẢI đúng logic phân trang này — không dùng `count: "exact"` kèm 1 lần fetch vì vẫn bị cap, phải loop `.range()`):

```ts
const PAGE_SIZE = 1000;

async function fetchAllPages(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<LotteryDrawRecord[]> {
  const results: LotteryDrawRecord[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    results.push(...(data as LotteryDrawRecord[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return results;
}

export async function loadWeekdayHistory(weekday: number): Promise<LotteryDrawRecord[]> {
  try {
    return await fetchAllPages((from, to) =>
      (getDb().from("lottery_draws") as any)
        .select("date, weekday, region, province, prizes")
        .eq("weekday", weekday)
        .order("date", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    throw new Error(`loadWeekdayHistory failed for weekday ${weekday}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function loadRegionHistory(region: LotteryRegion): Promise<LotteryDrawRecord[]> {
  try {
    return await fetchAllPages((from, to) =>
      (getDb().from("lottery_draws") as any)
        .select("date, weekday, region, province, prizes")
        .eq("region", region)
        .order("date", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    throw new Error(`loadRegionHistory failed for region ${region}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

Bạn có thể điều chỉnh cách viết (ví dụ inline thay vì helper chung) miễn giữ đúng hành vi: loop `.range()` theo page 1000, dừng khi trang trả về < 1000 rows, và có `.order("date", {ascending: true})` để thứ tự ổn định giữa các trang (PostgREST không đảm bảo thứ tự nếu không có `ORDER BY`, có thể gây trùng/sót row giữa các trang phân trang).

**KHÔNG được đổi:**
- Signature public của 2 hàm (tên hàm, tham số, kiểu trả về `Promise<LotteryDrawRecord[]>`).
- Hàm `appendWeekdayHistory` — không liên quan tới bug này, giữ nguyên.
- Logic retention 3 năm (`HISTORY_RETENTION_DAYS`).

## Test

Có test file hiện tại: `tests/lottery/lottery-repository.test.ts` (nếu tồn tại) hoặc tương đương — kiểm tra trước bằng `Glob` pattern `tests/lottery/*repository*`. Nếu không có test cho repository này, thêm test mới verify:

1. Mock Supabase client trả về nhiều "trang" dữ liệu (ví dụ page 1 = 1000 rows, page 2 = 97 rows) khi gọi `.range()` nhiều lần — assert `loadWeekdayHistory`/`loadRegionHistory` gộp đủ **1097 rows** (không dừng lại ở 1000).
2. Case trang cuối trả về đúng bội số của `PAGE_SIZE` (ví dụ tổng 2000 rows chia đúng 2 trang 1000) — assert loop dừng đúng (không gọi trang thứ 3 rỗng nếu có thể detect bằng `data.length < PAGE_SIZE`, hoặc nếu implementation của bạn luôn gọi thêm 1 trang rỗng để confirm hết dữ liệu thì đó cũng chấp nhận được — miễn kết quả cuối cùng đúng và không lặp vô hạn).
3. Case error ở giữa (page 2 trả `error`) — assert function throw đúng message có tên hàm + lý do lỗi (giữ format lỗi tương tự bản gốc: `"loadWeekdayHistory failed for weekday {weekday}: {message}"`).

## Verify trước khi báo cáo hoàn thành

1. `npm run build` — phải pass, không lỗi TypeScript.
2. `npm run test` — toàn bộ suite phải pass, không breaking test nào khác (đặc biệt các test dùng `loadWeekdayHistory`/`loadRegionHistory` mock trong `tests/lottery/`).
3. Nếu có credential Supabase thật trong `.env` (đã có sẵn trong repo, không cần hỏi), chạy thử thật (không bắt buộc nhưng khuyến khích để tự confirm fix hoạt động — không cần ghi vào result.md nếu không chạy được, nhưng NẾU chạy được, ghi rõ số rows trả về):

```bash
npx tsx -e "
import('./src/shared/infra/env.js').then(async () => {
  const { loadWeekdayHistory } = await import('./src/lottery/repository/lottery-repository.js');
  const rows = await loadWeekdayHistory(4);
  console.log('weekday=4 total rows:', rows.length);
});
"
```
Kỳ vọng: `1097` (hoặc nhiều hơn nếu có thêm dữ liệu mới từ lúc viết task này tới lúc bạn chạy — miễn KHÔNG bị cap dừng đúng ở 1000).

## Ghi kết quả

Ghi vào `tasks/lottery-history-truncation-fix/01-paginate-history-queries/result.md`:
- Diff/tóm tắt thay đổi (file, số dòng).
- Kết quả `npm run build`, `npm run test` (pass/fail, số test).
- Nếu đã chạy thử thật: số rows trả về cho `loadWeekdayHistory(4)` và từng `loadRegionHistory(region)`.
- Nếu bị chặn (thiếu quyền, lỗi env, v.v.) → ghi `blocked.md` thay vì đoán.
