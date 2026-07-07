# Task 04 — Deduplicate fetch+retry+parse pattern in ohlc-provider.ts (LOW)

## Vấn đề

`src/charts/ohlc-provider.ts` có 3 bản gần giống nhau của pattern "fetch +
withRetry + check `!res.ok` + tạo Error có `.status` + bắt network error +
parse JSON":
1. `fetchJson<T>` (~dòng 150-183) — dùng cho region/domain lookup.
2. Đoạn fetch candle history nhánh MetaApi (~dòng 431-459), viết inline,
   KHÔNG dùng lại `fetchJson`.
3. `fetchFromTwelveData` (~dòng 306-341), viết inline riêng, có thêm
   `withConfiguredRateLimit` và logic parse `message` field khi lỗi.

## Yêu cầu

Tổng quát hóa `fetchJson` để dùng được cho cả 3 chỗ, HOẶC viết 1 hàm
`fetchWithRetry` cấp thấp hơn mà cả 3 chỗ cùng gọi. Gợi ý hướng tiếp cận:

```ts
async function fetchWithRetry(
  url: string,
  options: { headers?: Record<string, string>; label: string; retryOptions?: Partial<RetryOptions>; rateLimit?: { key: string; envVar: string; defaultRpm: number } },
): Promise<Response | Error> {
  // Nếu options.rateLimit có, bọc bằng withConfiguredRateLimit
  // Gọi withRetry(...) như hiện tại, trả Response hoặc Error
}
```

Sau đó:
- `fetchJson<T>` gọi `fetchWithRetry` rồi tự `.json()`.
- Đoạn MetaApi candle fetch gọi `fetchWithRetry` (không rate limit) rồi tự
  parse.
- `fetchFromTwelveData` gọi `fetchWithRetry` VỚI `rateLimit` option, giữ logic
  parse `message` field riêng cho error case (đặc thù Twelve Data, không cần
  đưa vào hàm chung).

Tự quyết định chi tiết signature cho phù hợp — miễn giảm được số bản
fetch+retry+error-wrap từ 3 xuống còn 1 lõi dùng chung, hành vi bên ngoài
(URL gọi, header, thông báo lỗi trả về) PHẢI giữ nguyên 100%.

## KHÔNG làm

- Không đổi format thông báo lỗi (message string) mà test hiện có đang assert
  — kiểm tra kỹ `tests/charts/ohlc-provider.test.ts` trước khi đổi, giữ
  nguyên các message đang được test match.
- Không đổi retry policy (maxAttempts, baseDelayMs) cho bất kỳ nhánh nào.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```
Toàn bộ test phải pass không đổi kết quả.

## Ghi kết quả

`result.md`: helper mới, 3 call site đã thay thế, kết quả build + test.
