# Kiểm tra luồng production không vỡ + đồng bộ lại dự đoán đã lưu theo rule mới

## Context

2 thay đổi gần nhất đã merge vào `main` (chưa rollback):
1. [src/lottery/lottery-repository.ts](../src/lottery/lottery-repository.ts) — `loadWeekdayHistory()` đổi từ "lỗi Supabase → âm thầm trả `[]`" sang **throw Error**. Đây là thay đổi **ngoài phạm vi** đã giao (Codex tự thêm khi làm task khác), chưa được xác nhận có an toàn cho production hay không.
2. [src/lottery/lottery-predict.ts](../src/lottery/lottery-predict.ts) — `DECAY_BY_REGION`, `OVERDUE_BONUS_BY_REGION`, `STATION_SPREAD_WEIGHT_BY_REGION` đổi giá trị production (Bắc: decay 0.95→0.98, overdueBonus 0.3→0.2; Trung: overdueBonus 0.3→0, stationSpreadWeight 0→0.15; Nam: decay 0.93→0.9, overdueBonus 0.3→0.2). Đã backtest xác nhận `edge` cải thiện, nhưng **các dự đoán đã lưu vào bảng `lottery_predictions` TRƯỚC khi code này deploy vẫn dùng công thức CŨ** — nếu deploy sau khi cron `lottery-predict.yml` đã chạy hôm nay (chạy `0 1 * * *` UTC = 8h sáng giờ VN), dự đoán cho kỳ tới có thể đang lưu kết quả tính theo rule cũ, không khớp với rule mới đã deploy.

Người dùng yêu cầu 2 việc:
1. **Kiểm tra thay đổi #1 có làm vỡ luồng production không**
2. **Ngày mai, kiểm tra lại dữ liệu dự đoán trong database** — nếu dự đoán đã lưu không khớp với rule mới (tức được tính từ rule cũ), xoá và tính lại theo rule mới

## Phần 1 — Đánh giá thay đổi `loadWeekdayHistory()` throw-on-error

### Các nơi gọi `loadWeekdayHistory()` (4 vị trí, không có call site nào tự try/catch riêng):
- [lottery-predict-runner.ts:57](../src/lottery/lottery-predict-runner.ts) — trong `historyForWeekday()`, gọi trong vòng lặp `for (const region of REGIONS)` của `runLotteryPredict()`
- [lottery-runner.ts:38,68](../src/lottery/lottery-runner.ts) — 2 lần trong `runLotteryCheck()`
- [lottery-backfill-runner.ts:33](../src/lottery/lottery-backfill-runner.ts) — trong vòng lặp backfill

### Cơ chế bắt lỗi hiện có
Tất cả entrypoint (`lottery-predict-index.ts`, `lottery-index.ts`, `lottery-backfill-index.ts`) đều bọc runner bằng:
```ts
runXxx().catch(async (error) => {
  console.error("Fatal error:", error);
  await notifyError("...", error);
  process.exit(1);
});
```
→ Nếu `loadWeekdayHistory()` throw, lỗi sẽ được bắt ở top-level, gửi cảnh báo qua Telegram (`notifyError`), rồi `process.exit(1)`. **Không có khả năng job chết âm thầm không ai biết** — đây là điểm tích cực của thay đổi.

### Thay đổi hành vi cụ thể (so với trước)
- **Trước**: nếu Supabase lỗi tạm thời khi load 1 thứ trong tuần, `loadWeekdayHistory()` trả `[]` → các region dùng thứ đó bị bỏ qua âm thầm (log "không có dữ liệu", không gửi Telegram báo lỗi) — job vẫn chạy tiếp các region/thứ khác nếu có.
- **Sau**: lỗi Supabase ở **bất kỳ lần gọi nào** sẽ làm **toàn bộ job dừng ngay lập tức** (`runLotteryPredict()`/`runLotteryCheck()`/backfill loop), không xử lý tiếp các region còn lại trong cùng lần chạy, dù các region đó có thể không liên quan tới lỗi.

### Kết luận
**Không "vỡ" theo nghĩa crash không kiểm soát hay mất dữ liệu** — lỗi luôn được Telegram báo về, job luôn thoát có kiểm soát (`process.exit(1)`), không có khả năng treo (hang) hay throw bất ngờ ở chỗ không ai catch. Nhưng **đổi nguyên tắc chịu lỗi (fault tolerance)**: từ "best-effort, bỏ qua phần lỗi" sang "fail-fast, dừng toàn bộ khi có 1 lỗi". Với `runLotteryPredict()` cụ thể: nếu Supabase lỗi tạm thời ngay khi đang xử lý Miền Nam (vùng đầu tiên trong `REGIONS`), thì Miền Trung và Miền Bắc trong cùng lần chạy đó **sẽ không có dự đoán nào được gửi luôn**, dù lẽ ra dữ liệu của 2 miền này không liên quan tới lỗi đó.

### Khuyến nghị
Giữ nguyên thay đổi throw (đúng hướng, tránh nuốt lỗi im lặng) — **không cần rollback**. Nhưng cân nhắc thêm 1 cải tiến nhỏ (tuỳ chọn, không bắt buộc): bọc riêng từng region trong vòng lặp `runLotteryPredict()` bằng try/catch + `console.warn`, để 1 region lỗi không kéo sập toàn bộ các region khác trong cùng lần chạy — tương tự cách `lottery-runner.ts` đã làm với `fetchActualRecords()` (xem `lottery-runner.ts:50-59`, mẫu pattern có sẵn để tái dùng). Đánh giá: **không bắt buộc phải làm ngay**, vì lưu lượng lỗi Supabase trong thực tế là hiếm, và hành vi "fail-fast + báo Telegram" vẫn an toàn hơn hành vi cũ về mặt phát hiện sự cố. Để tuỳ Codex/người dùng quyết định có làm thêm phần này hay không.

## Phần 2 — Script đồng bộ lại dự đoán đã lưu theo rule mới

### Vấn đề
`lottery_predictions` có thể chứa dự đoán cho ngày/miền sắp tới (`verified_at IS NULL`, `date >= hôm nay`) được tính **trước** khi rule mới deploy — các số này không phải là top-3 mà rule mới sẽ chọn.

### Cách kiểm tra & sửa
Viết 1 script một lần (`src/lottery/lottery-predict-resync-index.ts`, có thể xoá sau khi dùng xong hoặc giữ lại làm tiện ích bảo trì), logic:

1. Query bảng `lottery_predictions` lấy các dòng `verified_at IS NULL` và `date >= hôm nay` (giờ VN) — đây là các dự đoán "chưa xác minh", thuộc kỳ tương lai/hiện tại, có khả năng bị lệch rule.
2. Group theo `(date, region)`.
3. Với mỗi nhóm: lấy `weekday` tương ứng, gọi `loadWeekdayHistory(weekday)` lấy lại lịch sử, lọc theo `region`, gọi `predictTopNumbers(records, region, 3)` (dùng code/rule **hiện tại**, đã deploy) để tính lại top-3 thật sự đúng.
4. So sánh tập số mới tính được với tập số đang lưu trong DB cho `(date, region)` đó:
   - Nếu **giống hệt** (cùng 3 số, không cần cùng thứ tự rank) → bỏ qua, không cần sửa.
   - Nếu **khác** → gọi `savePredictions(date, weekday, region, newPredictions)` để ghi đè (hàm này đã tự xoá số cũ không còn nằm trong top-N mới — xem [lottery-predictions-repository.ts:18-49](../src/lottery/lottery-predictions-repository.ts), không cần tự viết logic xoá thủ công).
5. In ra console + gửi 1 tin nhắn Telegram tổng kết (`sendMessage`) liệt kê các `(date, region)` đã bị resync, kèm số cũ → số mới, để người dùng biết đã có thay đổi.

### Khung code gợi ý cho `lottery-predict-resync-index.ts`
```ts
import "../shared/env.js";
import { getDb } from "../shared/db.js";
import { loadWeekdayHistory } from "./lottery-repository.js";
import { predictTopNumbers } from "./lottery-predict.js";
import { savePredictions } from "./lottery-predictions-repository.js";
import { sendMessage, notifyError } from "../shared/telegram.js";
import type { LotteryRegion } from "./lottery-types.js";

function vnToday(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const today = vnToday();
  const { data, error } = await (getDb().from("lottery_predictions") as any)
    .select("date, weekday, region, number")
    .is("verified_at", null)
    .gte("date", today);
  if (error) throw new Error(`Query failed: ${error.message}`);

  type Row = { date: string; weekday: number; region: LotteryRegion; number: string };
  const rows = (data ?? []) as Row[];
  const groups = new Map<string, { date: string; weekday: number; region: LotteryRegion; numbers: Set<string> }>();
  for (const row of rows) {
    const key = `${row.date}|${row.region}`;
    const g = groups.get(key) ?? { date: row.date, weekday: row.weekday, region: row.region, numbers: new Set<string>() };
    g.numbers.add(row.number);
    groups.set(key, g);
  }

  const resynced: string[] = [];
  for (const g of groups.values()) {
    const history = (await loadWeekdayHistory(g.weekday)).filter((r) => r.region === g.region);
    if (history.length === 0) continue;

    const fresh = predictTopNumbers(history, g.region, 3);
    const freshNumbers = new Set(fresh.map((p) => p.number));
    const same = freshNumbers.size === g.numbers.size && [...freshNumbers].every((n) => g.numbers.has(n));
    if (same) continue;

    await savePredictions(g.date, g.weekday, g.region, fresh);
    resynced.push(`${g.region} ${g.date}: [${[...g.numbers].join(",")}] → [${fresh.map((p) => p.number).join(",")}]`);
  }

  if (resynced.length === 0) {
    console.log("✓ Không có dự đoán nào lệch rule mới, không cần sửa.");
    await sendMessage("🔁 *Resync dự đoán* — Không có thay đổi, mọi dự đoán đã đúng rule mới nhất.");
    return;
  }

  console.log(`✓ Đã resync ${resynced.length} dự đoán:\n${resynced.join("\n")}`);
  await sendMessage(`🔁 *Resync dự đoán* — Đã cập nhật ${resynced.length} dự đoán theo rule mới:\n\n${resynced.join("\n")}`);
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await notifyError("Lottery Predict Resync", error);
  process.exit(1);
});
```

Thêm npm script vào `package.json`:
```json
"lottery-predict-resync": "tsx src/lottery/lottery-predict-resync-index.ts"
```

### Cách chạy ngày mai
```bash
npm run lottery-predict-resync
```
Chạy **trước** khi `lottery-verify.yml` chạy xác minh kết quả thật trong ngày (để đảm bảo nếu có resync thì số được verify là số đúng theo rule mới, không phải số cũ).

## File cần tạo/sửa
- Mới: `src/lottery/lottery-predict-resync-index.ts` (Phần 2)
- Sửa: `package.json` — thêm script `lottery-predict-resync`
- Không cần sửa gì thêm cho Phần 1 (chỉ là đánh giá, không bắt buộc code thay đổi — trừ khi quyết định thêm try/catch per-region như khuyến nghị tuỳ chọn)

## Kiểm thử
1. `npx tsc --noEmit` — không lỗi type sau khi thêm file mới
2. Chạy `npm run lottery-predict-resync` — quan sát log, nếu có dự đoán bị lệch thì phải thấy dòng `region date: [cũ] → [mới]` rõ ràng
3. Sau khi chạy, query lại `lottery_predictions` cho `date >= hôm nay, verified_at IS NULL` — xác nhận số đã lưu khớp đúng với `predictTopNumbers()` hiện tại (chạy thử tính tay/log so sánh)
4. Xác nhận tin nhắn Telegram tổng kết được gửi đúng (test thử với `TELEGRAM_CHAT_ID` thật)
5. Không cần resync nếu hôm nay chưa từng chạy `lottery-predict.yml` kể từ lúc deploy rule mới — script tự nhận biết qua việc so sánh, chạy dư thừa không gây hại (idempotent)
