# Task 04 — Hoàn thiện dedup fetch+parse trong ohlc-provider.ts (LOW)

## Vấn đề

`src/charts/ohlc-provider.ts` có sẵn helper `fetchJson<T>` (dùng cho
provisioning/region lookup của MetaApi), nhưng 2 nơi fetch OHLC thực sự quan
trọng nhất — `fetchFromTwelveData` (~dòng 348) và nhánh fetch candle MetaApi
(~dòng 446) — mỗi bên vẫn tự viết lại `try { body = await response.json(); }
catch { return new Error(...) }` riêng thay vì gọi `fetchJson`.

## Yêu cầu

Sửa 2 nơi này để dùng lại `fetchJson<T>` thay vì tự parse JSON riêng —
CHÚ Ý: `fetchJson` hiện có thể chỉ nhận `(url, token, label)` cho MetaApi;
cần kiểm tra signature hiện tại và điều chỉnh cho phù hợp để dùng được cho cả
Twelve Data (khác header, có thêm rate limit) — có thể cần thêm tham số
optional cho `fetchJson` (ví dụ `headers` tùy chỉnh, `rateLimit` config) thay
vì tạo hàm hoàn toàn mới.

Giữ nguyên logic đặc thù của Twelve Data (parse `message` field từ response
lỗi qua `res.clone().json()`) — có thể để phần này NẰM NGOÀI `fetchJson`
(gọi `fetchJson` để lấy response/error cơ bản, xử lý thêm `message` field
riêng nếu cần) nếu gộp hoàn toàn vào `fetchJson` làm hàm quá phức tạp.

## KHÔNG làm

- Không đổi message lỗi mà test hiện có đang assert — kiểm tra kỹ
  `tests/charts/ohlc-provider.test.ts` trước khi đổi.
- Không đổi retry policy cho bất kỳ nhánh nào.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```
Toàn bộ test phải pass không đổi kết quả.

## Ghi kết quả

`result.md`: signature mới của `fetchJson` (nếu đổi), 2 call site đã thay
thế, kết quả build + test.
