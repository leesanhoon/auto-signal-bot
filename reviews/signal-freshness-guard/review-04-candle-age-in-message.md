# Review — Subtask 04: candle-age-in-message

**Verdict: CHANGES_REQUIRED**

## ISSUE-3 (HIGH): in mốc giờ đóng nến ở TƯƠNG LAI

**Vị trí:** `src/shared/telegram-smc.ts:35-41` và
`src/shared/telegram-volman.ts:28-34` (`getCandleCloseTime`).

**Vấn đề:**

```ts
return Math.floor(nowMs / intervalMs) * intervalMs + intervalMs;
```

`floor(now/interval)*interval` là mốc MỞ của nến đang chạy = mốc ĐÓNG của nến
đã đóng gần nhất. Cộng thêm `+ intervalMs` đẩy sang mốc đóng của nến ĐANG chạy
— chưa xảy ra.

Ví dụ 12:32 UTC, M15 → message in: `🕐 Nến gốc [M15] đóng: 12:45 10/07 UTC
(2 phút trước)`. 12:45 là 13 phút NỮA mới tới, nhưng bị dán nhãn "2 phút
trước". Số phút đúng (do bù trừ `+ interval` trong `minutesAgo`), mốc giờ sai
— user đối chiếu với chart sẽ thấy giờ đóng nến không khớp.

**Fix yêu cầu (cả 2 file):**

```ts
const closeTimeMs = Math.floor(nowMs / intervalMs) * intervalMs; // bỏ + intervalMs
const minutesAgo = Math.floor((nowMs - closeTimeMs) / 60000);     // bỏ bù interval
```

Test bắt buộc dùng fake timer: set now = 2026-07-10T12:32:00Z, M15 → assert
message chứa `12:30 10/07 UTC` và `(2 phút trước)` — KHÔNG phải `12:45`.

## ISSUE-4 (MEDIUM): tuổi nến tính từ đồng hồ lúc gửi, bỏ qua nến thực sự được phân tích

**Vấn đề:** `formatCandleAge` chỉ dùng `Date.now()`. Khi kết quả được gửi từ
cache (`origin.source === "cached"` — đặc biệt manual run dùng latest-cache có
thể cũ nhiều nến), dòng tuổi nến vẫn tính theo nến gần nhất so với giờ gửi →
tuyên bố độ tươi mà phân tích không có. Tính năng sinh ra để phơi bày độ trễ
nhưng đang che nó trong đúng trường hợp trễ nhất.

Đường ống có sẵn: `smc-index.ts:173` đã truyền `candleKey` qua
`deliveryContext` của `sendAllAnalysesSmc` nhưng builder không dùng.

**Fix yêu cầu (một trong hai, ưu tiên a):**
a) Truyền candle-close-ms thật (parse từ candleKey/origin, cẩn thận candleKey
   là mốc MỞ nến — cộng interval) xuống builder và tính tuổi từ đó.
b) Tối thiểu: khi `source === "cached"`, nối hậu tố ` — dữ liệu cache` vào
   dòng tuổi nến để user biết con số không phản ánh nến phân tích.

## Minor

- M3: `TIMEFRAME_MS`/`getCandleCloseTime`/`formatCandleAge` duplicate nguyên
  khối ở 2 file — đưa vào module chung (vd `src/shared/telegram-candle-age.ts`)
  khi sửa ISSUE-3, tests gộp về một chỗ.
- M4: `TIMEFRAME_MS[timeframe || "M15"]` — nhánh `|| "M15"` không bao giờ chạy
  (timeframe đã được check trước đó); tự biến mất khi áp dụng fix ISSUE-3.
- Tests hiện tại (`tests/shared/telegram-candle-age.test.ts`) chỉ assert "có
  chứa chuỗi/range hợp lệ" nên không bắt được ISSUE-3 — sau khi sửa phải có
  assertion mốc giờ tuyệt đối với fake timer.
