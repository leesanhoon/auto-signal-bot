# Task 03 — Consolidate 4 timeframe switch statements (LOW)

## Vấn đề

`src/charts/ohlc-provider.ts` có 4 hàm riêng biệt, mỗi hàm tự viết lại switch
3-case trên cùng kiểu `ChartTimeframe` (`M15`/`H4`/`D1`):
`getCacheTtl` (~dòng 41), `getIntervalMs` (~dòng 109), `toMetaApiTimeframe`
(~dòng 242), `toTwelveDataInterval` (~dòng 271). Thêm 1 giá trị
`ChartTimeframe` mới đòi hỏi sửa đồng bộ cả 4 chỗ — dễ sót.

## Yêu cầu

Tạo 1 config tập trung, ví dụ:
```ts
const TIMEFRAME_CONFIG: Record<ChartTimeframe, {
  cacheTtlMs: number;
  intervalMs: number;
  metaApiCode: string;
  twelveDataCode: string;
}> = {
  M15: { cacheTtlMs: 5 * 60 * 1000, intervalMs: 15 * 60 * 1000, metaApiCode: "15m", twelveDataCode: "15min" },
  H4:  { cacheTtlMs: 30 * 60 * 1000, intervalMs: 4 * 60 * 60 * 1000, metaApiCode: "4h", twelveDataCode: "4h" },
  D1:  { cacheTtlMs: 6 * 60 * 60 * 1000, intervalMs: 24 * 60 * 60 * 1000, metaApiCode: "1d", twelveDataCode: "1day" },
};
```
(Xác nhận đúng giá trị hiện tại của từng field bằng cách đọc code hiện có
trước khi copy — KHÔNG đoán giá trị, phải khớp 100% với behavior cũ.)

Thay 4 hàm bằng lookup đơn giản: `TIMEFRAME_CONFIG[timeframe].cacheTtlMs`,
v.v. `Record<ChartTimeframe, ...>` tự động cho TypeScript exhaustiveness
check (thiếu 1 key sẽ lỗi compile) — không cần switch/throw thủ công nữa,
đồng thời giải quyết luôn vấn đề uncaught-throw ở task 02 (nếu task 02 chưa
làm, việc dùng `Record` ở đây coi như tự động fix nó — báo lại trong
`result.md` nếu 2 task trùng nhau khi làm).

## KHÔNG làm

- Không đổi giá trị TTL/interval-ms/code string cho bất kỳ timeframe nào.
- Không đổi tên export public nếu có hàm nào đang được import từ file khác
  (kiểm tra trước bằng grep).

## Verification

```bash
npm run build
npm run test -- --run tests/charts/ohlc-provider.test.ts
```
Toàn bộ test phải pass không đổi kết quả (refactor thuần túy).

## Ghi kết quả

`result.md`: config mới, danh sách hàm đã thay thế, kết quả build + test.
