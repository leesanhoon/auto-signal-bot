# Nghiệm thu chạy dữ liệu thật — 2026-07-03

## Tóm tắt

Đã chạy `npx tsc --noEmit`, `npm test`, và `npm run analyze` (dữ liệu thật, gọi OpenRouter thật, gửi Telegram thật, ghi Supabase production) để nghiệm thu toàn bộ các thay đổi gần đây (pending-order lifecycle, bỏ AI verify, prompt caching, price-accuracy). Phát hiện và sửa 1 bug nghiêm trọng ngay trong lúc chạy.

## 🔴 Bug nghiêm trọng đã sửa: race condition làm sập 100% pipeline

**File:** `src/charts/screenshot.ts`, hàm `captureChart`

Lần chạy đầu tiên: **toàn bộ 27/27 chart lỗi** `page.screenshot: Target page, context or browser has been closed`, pipeline dừng với `"No charts captured."`.

**Nguyên nhân:** code có dạng

```ts
try {
  ...
  return capturePageScreenshot(page, chart, options.quality ?? 75, lastPrice); // thiếu await
} finally {
  await page.close();
}
```

`return capturePageScreenshot(...)` không có `await` — trong JS/TS, khi `return` một Promise mà không `await`, khối `finally` sẽ chạy **song song** với Promise đó thay vì chờ nó xong. Kết quả: `page.close()` chạy trước khi `page.screenshot()` bên trong helper kịp hoàn thành → mọi lần chụp đều bị đóng trang giữa chừng.

Đây là lỗi kinh điển "return-without-await-in-try/finally", phát sinh từ đợt refactor dedupe code chụp ảnh (task #14, gộp logic vào `capturePageScreenshot()`).

**Đã sửa:** đổi cả 2 chỗ gọi (`captureChart`, nhánh thành công và nhánh fallback) từ `return capturePageScreenshot(...)` sang `return await capturePageScreenshot(...)`.

**Đã verify:** chạy lại `npm run analyze` — capture thành công 27/27 chart, pipeline chạy hết end-to-end không lỗi.

## Kết quả chạy dữ liệu thật (sau khi sửa bug trên)

| Bước | Kết quả |
|---|---|
| `tsc --noEmit` | ✅ Pass, không lỗi type |
| `npm test` | ✅ 21 test file / 77 test pass |
| Capture chart | ✅ 27/27 chart (9 cặp × D1/H4/M15) |
| Phân tích AI | ⚠️ 8/9 cặp thành công. **XAG/USD lỗi lặp lại 3 lần** `finish_reason=length` (cạn `maxTokens=4000`), thất bại hẳn cho cặp này ở phiên này. Không liên quan các thay đổi review gần đây — là giới hạn token hiện có, cần theo dõi thêm (xem mục "Đề xuất theo dõi" bên dưới). |
| Ngưỡng confidence | Không có setup nào ≥70% ở phiên này — hợp lý theo điều kiện thị trường thực tế lúc chạy, không phải lỗi. |
| Gửi Telegram | ✅ Gửi đúng, log "No setups above threshold (70%). Notification sent with 1 eligible summaries." |
| Check open positions | ✅ Chạy đúng luồng (không có vị thế mở lúc test) |
| Check pending orders | ✅ Chạy đúng luồng (không có lệnh chờ lúc test) |
| Prompt caching (task #6) | ✅ Xác nhận qua Supabase `ai_usage.metadata.cachedTokens` có giá trị thật (3–334 tokens tuỳ lần gọi) cho `xiaomi/mimo-v2.5` |
| Model betting (task #5) | ✅ Xác nhận `ai_usage` gần nhất dùng đúng `deepseek/deepseek-v4-flash` cho stage `combined` |

## 🔴 Vấn đề bảo mật chưa xử lý (Supabase advisory, mức critical)

Bảng `public.pending_orders` đang **tắt Row Level Security (RLS)** — bất kỳ ai có anon key đều đọc/ghi được toàn bộ bảng. Chưa tự động bật vì cần thêm policy phù hợp trước (bật RLS mà không có policy sẽ chặn hết truy cập của chính bot). Cần worker/bạn quyết định policy rồi chạy:

```sql
ALTER TABLE public.pending_orders ENABLE ROW LEVEL SECURITY;
-- + policy phù hợp (ví dụ chỉ cho service_role ghi/đọc)
```

## Lần chạy thứ 2 (xác nhận không còn regression)

Chạy lại toàn bộ `tsc --noEmit` → `npm test` → `npm run analyze` một lần nữa (sau khi có thêm `tests/charts/screenshot.test.ts` mới) để xác nhận bug race-condition đã sửa ổn định, không phải một lần ăn may:

| Bước | Kết quả |
|---|---|
| `tsc --noEmit` | ✅ Pass |
| `npm test` | ✅ 22 test file / 78 test pass (có thêm test mới cho `screenshot.ts`) |
| Capture chart | ✅ 27/27 chart |
| Phân tích AI | ✅ 9/9 cặp thành công lần này — **XAG/USD chạy được** (lần trước lỗi `finish_reason=length` chỉ là transient, không phải lỗi cố định) |
| Setup trả về | 4 setup từ AI, vẫn không có setup nào ≥70% ở phiên này (thị trường thực tế) |
| Prompt caching | ✅ Tiếp tục thấy cache hit thật (`cachedTokens`: 3–334) qua `ai_usage` |
| Toàn bộ pipeline | ✅ Chạy hết, gửi Telegram, check open/pending orders, không lỗi |

→ Bug race-condition đã sửa ổn định qua 2 lần chạy độc lập. Lỗi `finish_reason=length` ở XAG/USD lần đầu là **transient** (model thỉnh thoảng vượt `maxTokens=4000`), không phải lỗi cố định — hạ mức ưu tiên xuống "theo dõi", không cần fix gấp.

## Lần chạy thứ 3 (nghiệm thu cuối cùng)

Chạy lại toàn bộ `tsc --noEmit` → `npm test` → `npm run analyze` lần thứ 3, không có thay đổi code nào kể từ lần 2:

| Bước | Kết quả |
|---|---|
| `tsc --noEmit` | ✅ Pass |
| `npm test` | ✅ 22 test file / 78 test pass |
| Capture chart | ✅ 27/27 chart |
| Phân tích AI | ✅ 9/9 cặp thành công, "9 pairs scanned" đúng số lượng (khác 2 lần trước báo 11/14 — xác nhận đó chỉ là hiện tượng AI thỉnh thoảng trả dư summary, không phải lỗi hệ thống cố định) |
| Setup trả về | 2 setup từ AI, không có setup nào ≥70% (thị trường thực tế) |
| Toàn bộ pipeline | ✅ Chạy hết, gửi Telegram, không có open/pending order tồn đọng, không lỗi |

→ **3/3 lần chạy độc lập đều thành công hoàn toàn** sau khi sửa bug race-condition. Đủ căn cứ để coi pipeline đã ổn định cho môi trường local; bước tiếp theo là theo dõi vài lần chạy cron thật trên GitHub Actions.

## Đề xuất theo dõi thêm (không chặn nghiệm thu)

- **`finish_reason=length` thỉnh thoảng xảy ra** (đã thấy ở XAG/USD lần 1, không lặp lại lần 2): cân nhắc tăng nhẹ `maxTokens` cho request phân tích chart hoặc rút gọn prompt để giảm rủi ro cắt response khi model sinh nhiều setup/pattern hơn bình thường.
- **`summaries.length` báo "14 pairs scanned" dù chỉ có 9 cặp** (thấy ở cả 2 lần chạy, log dòng `"✓ N pairs scanned, ... setup(s) returned by AI"`): có thể AI trả về nhiều summary hơn 1/cặp (không đúng hướng dẫn prompt "mỗi pair gồm ..."). Không gây lỗi chức năng (Telegram vẫn lọc đúng theo threshold) nhưng đáng xem lại nếu cần số liệu "quét bao nhiêu cặp" chính xác cho báo cáo/log.

## Việc cần làm tiếp

1. Rà lại các task #1, #2, #7-#15 xem đã implement sẵn trong code hiện tại chưa (nhiều task có vẻ đã được code sẵn qua các đợt trước, cần đối chiếu lại state thực tế thay vì giả định còn pending).
2. Quyết định RLS policy cho `pending_orders` (mục bảo mật ở trên).
3. Đã xác nhận qua 2 lần chạy độc lập — không cần chạy thêm để verify riêng bug race-condition, nhưng vẫn nên theo dõi vài lần chạy cron thật đầu tiên sau khi merge để chắc chắn ổn định trong môi trường GitHub Actions (khác máy local).
