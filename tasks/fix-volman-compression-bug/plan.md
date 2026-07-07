# Plan — Fix Volman compression off-by-one bug (BB/RB/ARB/IRB/SB never fire)

## Context

Backtest thực tế trên dữ liệu Twelve Data (H4 500 nến ~83 ngày, M15 1500 nến
~15.6 ngày, 8 cặp forex/vàng) cho thấy chỉ **DD** và **FB** từng ra tín hiệu.
**BB, RB, ARB, IRB, SB không kích hoạt lần nào.**

Đọc code phát hiện đây là **bug logic**, không phải vấn đề ngưỡng (threshold)
chặt như nghi ngờ ban đầu.

## Root cause

`detectCompression(candles, ema20, atr14, endIndex, windowSize, kBlock)` trong
`src/charts/indicators.ts:170` tính `high`/`low` là max/min trên cửa sổ
`[endIndex-windowSize+1, endIndex]`.

5 file gọi hàm này với **`endIndex = index`** — cửa sổ compression bao gồm
CHÍNH nến đang được kiểm tra breakout:
- `src/charts/setups/bb.ts:46`
- `src/charts/setups/rb.ts:32`
- `src/charts/setups/arb.ts:32`
- `src/charts/setups/irb.ts:31,49` (cả RangeOuter lẫn RangeInner)
- `src/charts/setups/sb.ts:50` (newBlock)

Sau đó code check breakout bằng `candles[index].close > block.high` (hoặc
`< block.low`). Vì `block.high = max(High)` trên cửa sổ đã bao gồm chính
`candles[index].high`, luôn có `block.high >= candles[index].high >= candles[index].close`
→ `close > block.high` **không bao giờ đúng được** (và tương tự cho SHORT).
Đây là lỗi toán học, xảy ra ở mọi input.

**Bằng chứng củng cố:** 4 unit test cho BB/RB/ARB/IRB trong
`tests/charts/setups.test.ts:134-227` đều viết dạng
`expect(signal === null || signal!.setup === "BB").toBe(true)` — **luôn pass
dù signal null hay không** — nên bug này sống sót qua 4 vòng review (28
finding) trước đó mà không ai phát hiện.

## Mục tiêu

1. Sửa 5 file setup để block/range hình thành TRƯỚC nến hiện tại (endIndex =
   `index - 1`), nến `index` chỉ dùng để xác nhận breakout.
2. Sửa 4 test tautological thành test thật — assert signal khác null với dữ
   liệu breakout rõ ràng.
3. Cho phép backtest runner cấu hình timeframe + số nến qua env, để test lại
   trên M15 khoảng 30-60 ngày (không chỉ 15.6 ngày như trước).
4. Verify: build clean, toàn bộ test pass, backtest H4 + M15 cho thấy
   BB/RB/ARB/IRB/SB bắt đầu xuất hiện (trước đó luôn 0 lệnh).

## Subtasks

- `01-fix-compression-endindex/` — sửa root cause trong 5 file setup
- `02-fix-tautological-tests/` — sửa 4 unit test + fixture thật
- `03-backtest-runner-config/` — parameterize setup-backtest-runner.ts qua env

## Không làm ở vòng này

- Không chỉnh ngưỡng (Zdoji, Kblock, slope threshold...) — chỉ sau khi có số
  liệu backtest thật với bug đã fix mới quyết định có cần tinh chỉnh hay không.
- Không đổi logic confidence scoring.
