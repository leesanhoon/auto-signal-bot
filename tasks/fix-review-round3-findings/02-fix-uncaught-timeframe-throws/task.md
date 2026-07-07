# Task 02 — Fix uncaught throws in getCacheTtl/getIntervalMs (MEDIUM)

## Vấn đề

`src/charts/ohlc-provider.ts`: `getCacheTtl` (dòng ~41) và `getIntervalMs`
(dòng ~109) dùng pattern exhaustiveness-check `const exhaustive: never =
timeframe; throw new Error(...)` ở nhánh `default`. Đây là pattern GIỐNG với
`toMetaApiTimeframe`/`toTwelveDataInterval` trong CÙNG file — nhưng khác biệt
quan trọng: `toMetaApiTimeframe`/`toTwelveDataInterval` LUÔN được gọi trong
khối `try/catch` chuyển throw thành `return new Error(...)` (đúng quy ước
CLAUDE.md: "Error handling: return Error objects, không throw — catch ở top
level"), còn `getCacheTtl` (gọi ở dòng ~399, ~494) và `getIntervalMs` (gọi
qua `shouldSkipLatestCandle` ở dòng ~138, ~372, ~488) KHÔNG được bọc
try/catch nào.

Hiện tại không crash được vì TypeScript đảm bảo `ChartTimeframe` luôn có 1
trong 3 giá trị hợp lệ — nhưng nếu có `as ChartTimeframe` cast ở đâu đó hoặc
`ChartTimeframe` thêm giá trị mới, exception sẽ thoát ra khỏi
`fetchOhlcHistory`/`fetchFromTwelveData` (async function) dưới dạng rejected
promise, phá vỡ hợp đồng "trả Error, không throw" mà cả module đang tuân thủ.

## Yêu cầu

Chọn 1 trong 2 cách (ghi rõ đã chọn cách nào trong `result.md`):

**Cách A (khuyến nghị — nhất quán với `toMetaApiTimeframe`):** Bọc mọi lời
gọi `getCacheTtl`/`getIntervalMs`/`shouldSkipLatestCandle` trong try/catch ở
từng call site, convert throw thành `return new Error(...)` — giống hệt cách
`toMetaApiTimeframe` đang được xử lý.

**Cách B (tập trung hơn):** Đổi `getCacheTtl`/`getIntervalMs` từ throw sang
trả `number | null`, caller check `null` và tự return `Error` — tránh phải
thêm try/catch rải rác ở nhiều call site.

## KHÔNG làm

- Không đổi giá trị TTL/interval-ms cho từng timeframe (chỉ đổi cách xử lý
  lỗi, không đổi số).
- Không đổi `toMetaApiTimeframe`/`toTwelveDataInterval` (đã đúng, không cần
  sửa).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```

## Ghi kết quả

`result.md`: cách đã chọn (A hay B) và lý do, các call site đã sửa, kết quả
build + test.
