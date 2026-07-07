# Task 01 — Fix compression window off-by-one in BB/RB/ARB/IRB/SB

## Vấn đề

`detectCompression(candles, ema20, atr14, endIndex, windowSize, kBlock)`
(`src/charts/indicators.ts`) tính `high`/`low` là max/min trên cửa sổ
`[endIndex-windowSize+1, endIndex]` — INCLUSIVE cả `endIndex`.

5 file dưới đây gọi hàm này với `endIndex = index` (nến hiện tại đang xét
breakout), rồi kiểm tra `candles[index].close > block.high`. Vì block.high đã
bao gồm chính `candles[index].high`, và `close <= high` luôn đúng, điều kiện
breakout **không bao giờ thỏa mãn được**. Đây là lý do BB/RB/ARB/IRB/SB không
bao giờ trả tín hiệu.

## Yêu cầu

Đổi `endIndex` truyền vào MỌI lệnh gọi `detectCompression` từ `index` thành
`index - 1` trong các file sau. KHÔNG đổi gì khác (giữ nguyên toàn bộ
threshold, kBlock, windowSize, confidence logic).

### 1. `src/charts/setups/bb.ts`
Dòng có `detectCompression(candles, ctx.ema20, ctx.atr14, index, w, 1.2)` bên
trong vòng `for (const w of windowSizes)` → đổi `index` thành `index - 1`.

### 2. `src/charts/setups/rb.ts`
Dòng có `detectCompression(candles, ctx.ema20, ctx.atr14, index, w, kBlockRb)`
→ đổi `index` thành `index - 1`.

Lưu ý: phần code sau đó tính `slopeNow`/`slopeBefore` dùng
`ctx.ema20[index]`, `ctx.ema20[index - 5]`, `ctx.ema20[index - 10]` — KHÔNG
đổi các chỗ này, chúng độc lập với block.

### 3. `src/charts/setups/arb.ts`
Dòng có `detectCompression(candles, ctx.ema20, ctx.atr14, index, w, kBlockArb)`
→ đổi `index` thành `index - 1`.

Lưu ý: vòng lặp đếm edge test (`for (let i = range.startIndex; i < index; i++)`)
giữ nguyên — nó scan từ `range.startIndex` tới trước `index`, logic này không
đổi vì `range.startIndex` sẽ tự dịch theo `endIndex` mới.

### 4. `src/charts/setups/irb.ts`
Có 2 lệnh gọi `detectCompression`:
- RangeOuter: `detectCompression(candles, ctx.ema20, ctx.atr14, index, w, kBlockOuter)`
- RangeInner: `detectCompression(candles, ctx.ema20, ctx.atr14, index, w, kBlockInner)`

Đổi CẢ HAI `index` thành `index - 1`.

Sau khi đổi, đoạn code "check previous candle" (dùng `candles[index - 1]` để
xử lý case RangeInner break ở nến trước, RangeOuter break ở nến sau — 2 đoạn
gần dòng `if (!breaksOuterUp)` và `if (!breaksOuterDown)`) cần xem lại: vì giờ
RangeInner/RangeOuter tự nhiên đã kết thúc ở `index - 1` (không còn bao gồm
nến hiện tại), đoạn "check previous candle" bên trong có thể giữ nguyên
(không bắt buộc xóa) — chỉ cần đảm bảo logic không bị lỗi off-by-one lần 2.
Nếu không chắc, giữ nguyên đoạn này y hệt, chỉ sửa 2 lệnh gọi
`detectCompression` như yêu cầu.

### 5. `src/charts/setups/sb.ts`
Dòng có `detectCompression(candles, ctx.ema20, ctx.atr14, index, w, 1.2)` (biến
`newBlock`) → đổi `index` thành `index - 1`.

## Verification

Sau khi sửa cả 5 file:
```bash
npm run build
```
Phải pass không lỗi TypeScript (không đổi type/signature nào nên sẽ không có
lỗi biên dịch).

KHÔNG chạy `npm run test` ở task này — task 02 sẽ sửa test và chạy full suite.
Chỉ cần đảm bảo `npm run build` clean.

## Ghi kết quả

Viết `result.md` trong thư mục này, liệt kê:
- 5 file đã sửa, mỗi file đổi bao nhiêu chỗ (1 chỗ cho bb/rb/arb/sb, 2 chỗ cho irb)
- Kết quả `npm run build`
