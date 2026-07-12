# Review: Task 02 — repository-filter-timeframe

## Verdict: CHANGES_REQUIRED (đã tự vá bug nghiêm trọng bởi Lead)

Không có `result.md` cho task này (Worker chỉ commit, không ghi result — cần nhắc Worker tuân thủ
quy trình ghi `result.md` cho các task sau).

## Việc đúng

- `loadOpenPositions(timeframe)` — thêm đúng `.eq("primary_timeframe", timeframe)`.
- `runCheckOpenTrades(timeframe)` — truyền đúng xuống `loadOpenPositions`.
- `index.ts` — truyền `primaryTimeframe` xuống cả `runCheckOpenTrades` và `pollPendingEntryOrders`.
- `pollPendingEntryOrders(timeframe?)` — tham số optional, không phá `smc-index.ts` (vẫn gọi
  `pollPendingEntryOrders()` không truyền gì → an toàn cho SMC).

## Bug nghiêm trọng — ĐÃ ĐƯỢC LEAD FIX TRỰC TIẾP

Dòng filter mới thêm trong `binance-execution-shared.ts`:

```ts
if (timeframe) {
  pending = pending.filter((p: any) => p.primaryTimeframe === timeframe);
}
```

`p.primaryTimeframe` **luôn là `undefined`** — hàm `getPendingEntryOrderPositions()` (định nghĩa
trong `positions-repository-binance-entry-order-shared.ts`, dùng chung cho cả SMC và Volman) chưa
bao giờ SELECT hay map cột `primary_timeframe` vào object trả về. `undefined === "M15"` luôn
`false` → **mảng `pending` bị lọc RỖNG mỗi khi có truyền timeframe** (tức luôn luôn, vì
`index.ts` đã sửa để luôn truyền `primaryTimeframe`).

**Hệ quả thực tế**: kể từ khi task 02 được merge, mọi lệnh entry LIMIT/STOP đang chờ khớp của
Volman (`binance_entry_order_status = 'working'`) **không còn được kiểm tra/hết hạn/khớp** ở bất kỳ
lần chạy `npm run analyze` nào nữa — vòng lặp `for (const position of pending)` không bao giờ chạy.
Đây là lỗi nghiêm trọng cho hệ đang live trading thật (dù trên testnet).

Không có test nào phát hiện được (test hiện có cho `pollPendingEntryOrders` chỉ check "resolves"/
"is a function", không assert hành vi filter thật).

### Fix đã áp dụng (Lead tự sửa, không đợi Worker)

Vì `open_positions_smc` KHÔNG có cột `primary_timeframe` (đã verify trực tiếp trên Supabase — select
trả về rỗng), không thể thêm cột này vào SELECT chung cho cả 2 hệ. Đã sửa:

1. `positions-repository-binance-entry-order-shared.ts`: `createGetPendingEntryOrderPositions(table,
   includeTimeframe = false)` — thêm tham số `includeTimeframe`, chỉ SELECT + map thêm
   `primary_timeframe` → `primaryTimeframe` khi `true`.
2. `positions-repository-volman.ts`: gọi `createGetPendingEntryOrderPositions("open_positions_volman",
   true)` — Volman bật cờ này.
3. `positions-repository-smc.ts`: **không đổi** — vẫn `createGetPendingEntryOrderPositions("open_positions_smc")`
   (mặc định `false`), SMC không bị ảnh hưởng.
4. Thêm field `primaryTimeframe?: ... | null` vào CẢ 2 định nghĩa type `PendingEntryOrderPosition`
   (một ở `positions-repository-binance-entry-order-shared.ts`, một bị trùng lặp riêng ở
   `binance-execution-shared.ts` — ghi chú luôn: đây là 2 type trùng tên, trùng cấu trúc, ĐỊNH NGHĨA
   Ở 2 NƠI KHÁC NHAU, dễ gây lệch nhau về sau — nên cân nhắc gộp làm 1 khi có dịp refactor, không
   bắt buộc sửa ngay bây giờ).
5. Thêm 2 test mới trong `tests/charts/binance-execution-shared.test.ts`:
   - "filters pending positions by timeframe when a timeframe arg is passed" — verify chỉ xử lý
     đúng các position có `primaryTimeframe` khớp.
   - "does not filter when no timeframe arg is passed (SMC call site behavior)" — verify SMC
     (không truyền timeframe) không bị ảnh hưởng.

### Verify sau khi fix

- `npx tsc --noEmit` sạch.
- `npx vitest run` — **900/900 pass** (898 cũ + 2 test mới).

## Ghi chú cho Worker

- Từ nay, bất kỳ thay đổi nào động vào field lấy từ DB (thêm cột, filter theo field mới) PHẢI viết
  test dương tính xác nhận filter thực sự hoạt động đúng (không chỉ test "không crash") — bug lần
  này lẽ ra bị bắt ngay nếu có 1 test kiểu vậy.
- Luôn ghi `result.md` sau khi hoàn thành task, dù nhanh đến đâu — Lead cần bản ghi để review, không
  chỉ dựa vào commit message.
