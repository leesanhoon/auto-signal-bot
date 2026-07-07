# Task 04 — Replace bespoke Twelve Data rate limiter with shared helper (HIGH)

## Vấn đề (đã xác nhận đọc code)

`src/charts/ohlc-provider.ts` tự viết rate limiter (`waitForTwelveDataSlot`,
mảng `twelveDataCallTimestamps`) thay vì dùng helper có sẵn
`src/shared/rate-limit.ts` (đã dùng ở `src/shared/openrouter.ts:58` và
`src/betting/betting-api.ts:35` qua `withConfiguredRateLimit`).

2 vấn đề cụ thể với bản tự viết:

1. **Tốn 1 slot mỗi lần retry, không phải mỗi request logic**:
   `waitForTwelveDataSlot()` được gọi BÊN TRONG closure được `withRetry` gọi
   lại (dòng `await waitForTwelveDataSlot();` ngay đầu callback truyền cho
   `withRetry`). Vì `429` nằm trong `DEFAULT_RETRYABLE_STATUS`
   (`src/shared/retry.ts:13`), mỗi lần retry (tối đa 3 lần) lại tốn thêm 1
   slot từ ngân sách 60s dùng chung — đúng lúc hệ thống đang bị 429 (hết
   ngân sách) thì retry lại càng làm cạn ngân sách nhanh hơn, kéo dài thời
   gian chờ vượt xa mức cần thiết.

2. **Không serialize giữa các caller đồng thời**: `withConfiguredRateLimit`
   dùng `tail` promise chain để đảm bảo các caller đồng thời được cấp slot
   tuần tự (FIFO), còn bản tự viết để mỗi caller tự poll mảng
   `twelveDataCallTimestamps` độc lập — dưới tải 8 cặp gọi song song, có thể
   gây thức dậy/polling lặp lại không cần thiết.

## Yêu cầu

Trong `src/charts/ohlc-provider.ts`:

1. Xóa `waitForTwelveDataSlot`, biến `twelveDataCallTimestamps`, và hằng
   `TWELVEDATA_RATE_LIMIT_RPM` (giữ logic đọc env var, chỉ đổi cách dùng).

2. Import `withConfiguredRateLimit` từ `../shared/rate-limit.js`.

3. Trong `fetchFromTwelveData`, bọc TOÀN BỘ `withRetry(...)` (không chỉ phần
   `fetch`) bằng `withConfiguredRateLimit`, để mỗi LẦN GỌI LOGIC (không phải
   mỗi lần retry) chỉ tốn đúng 1 slot:

   ```ts
   response = await withConfiguredRateLimit(
     { key: "twelvedata", envVar: "TWELVEDATA_RATE_LIMIT_RPM", defaultRpm: 7 },
     () =>
       withRetry(
         async () => {
           const res = await fetch(url, { headers: { Accept: "application/json" } });
           // ... giữ nguyên logic bên trong ...
         },
         { maxAttempts: 3, baseDelayMs: 1000, onRetry: (...) => {...} },
       ),
   );
   ```

   Lưu ý: đặt `withConfiguredRateLimit` BÊN NGOÀI `withRetry` — chỉ acquire
   slot 1 lần trước khi bắt đầu cả chuỗi retry, không phải mỗi lần retry.

4. Cập nhật `.env.example` nếu comment về `TWELVEDATA_RATE_LIMIT_RPM` cần
   sửa lại cho khớp (mặc định vẫn là 7, không đổi giá trị mặc định).

## KHÔNG làm

- Không đổi behavior của nhánh MetaApi.
- Không đổi `src/shared/rate-limit.ts` — dùng nguyên trạng.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

Kiểm tra lại test hiện có về Twelve Data (mock `globalThis.fetch`) vẫn pass —
có thể cần `resetRateLimitStateForTests()` (export sẵn trong
`src/shared/rate-limit.ts`) gọi trong `beforeEach` của test Twelve Data để
tránh state rate-limit rò rỉ giữa các test.

## Ghi kết quả

`result.md`: diff tóm tắt, kết quả build + test.
