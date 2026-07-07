# Task 01 — Fix deferred fresh signal ghi nhận entryIndex sai (HIGH)

## Vấn đề (đã xác nhận)

`src/charts/setup-backtest.ts`, khi 1 fresh signal bị hoãn (`deferredFreshSignals`,
do trùng index với 1 SB signal đang chín — xem dòng ~206-210) và sau đó được
xử lý lại (dòng ~190-193, khi `canRunFreshDetectors` trở lại `true`), nó đi
qua `resolveSetupConflicts` rồi `buildTrade(candles, signal, index)` ở dòng
~222 — **dùng biến `index` (vị trí walk-forward HIỆN TẠI)** thay vì
`signal.triggerIndex` (vị trí nến THẬT sự phát hiện ra signal này).

Hậu quả: `entryIndex` ghi trong `SetupBacktestTrade` là thời điểm rất muộn
(có thể cách xa hàng chục nến, tùy SB trade "thắng" giữ lệnh bao lâu), trong
khi `entryPrice`/`stopLoss`/`takeProfit1`/`takeProfit2` (lấy từ
`signal.entry`/`.stopLoss`/...) vẫn là giá trị tính TẠI thời điểm phát hiện
gốc (nến `triggerIndex`) — 1 trade bị ghi nhận với entry price/stop từ ngữ
cảnh giá cũ nhưng gắn nhãn thời điểm entry sai hẳn.

**Bằng chứng nghiêm trọng hơn:** test đã có
`tests/charts/setup-backtest-queue.test.ts` — case
`"does not double-count a false-break signal and its SB reversal"` — đang
`expect(...entryIndex).toBe(34)` cho 1 signal có `triggerIndex` thật là 33 —
tức bug này đã được code hóa thành "hành vi mong đợi" trong test, chứ không
chỉ là thiếu test.

## Yêu cầu

1. Sửa dòng gọi `buildTrade` cho trường hợp signal đến từ
   `deferredFreshSignals` (hoặc đơn giản hơn: sửa `buildTrade` để LUÔN dùng
   `signal.triggerIndex` làm `entryIndex` thay vì tham số `index` truyền
   riêng — kiểm tra xem có phá vỡ trường hợp khác không, vì với SIGNAL
   KHÔNG bị hoãn, `signal.triggerIndex` và `index` (lúc gọi buildTrade) LUÔN
   BẰNG NHAU — tức đổi sang dùng `signal.triggerIndex` là AN TOÀN cho MỌI
   trường hợp, không chỉ riêng case bị hoãn).

   Cụ thể: đổi
   ```ts
   const trade = buildTrade(candles, signal, index);
   ```
   thành
   ```ts
   const trade = buildTrade(candles, signal, signal.triggerIndex);
   ```
   (dòng ~222). Kiểm tra lại toàn bộ các chỗ khác gọi `buildTrade` trong file
   (nếu có gọi ở đâu khác) để đảm bảo áp dụng nhất quán.

2. Sau khi sửa, `scanOutcome` (bên trong `buildTrade`) sẽ quét từ
   `signal.triggerIndex` (đúng, thời điểm signal thực sự có thể vào lệnh) —
   xác nhận điều này KHÔNG gây lỗi gì (ví dụ `triggerIndex` luôn nhỏ hơn
   `candles.length`, đã đảm bảo vì signal chỉ được tạo ra từ dữ liệu đã có).

## Sửa test đang assert sai

Trong `tests/charts/setup-backtest-queue.test.ts`, case
`"does not double-count a false-break signal and its SB reversal"`: sửa lại
assertion `entryIndex` từ `34` thành giá trị ĐÚNG (`33`, hoặc giá trị
`triggerIndex` thật của signal trong fixture đó — tự kiểm tra lại fixture để
xác nhận con số chính xác sau khi fix).

## Test mới bắt buộc

Viết 1 test riêng cho ĐÚNG kịch bản "deferred signal": dựng 1 SB signal chín
tại index X trùng với 1 fresh signal khác cũng sẵn sàng tại X (signal thứ 2
có `triggerIndex = X`), SB thắng và giữ lệnh nhiều nến (ví dụ 5-10 nến) trước
khi đóng — xác nhận khi signal thứ 2 (đã bị hoãn) cuối cùng được xử lý,
`trade.entryIndex === X` (đúng bằng triggerIndex gốc của nó), KHÔNG PHẢI
bằng index tại thời điểm nó thực sự được thêm vào `trades[]`.

## KHÔNG làm

- Không đổi logic hoãn/không hoãn signal (`deferredFreshSignals` mechanism
  giữ nguyên) — chỉ sửa `entryIndex` được ghi nhận.
- Không đổi `scanOutcome`.

## Verification

```bash
npm run build
npm run test -- --run
```
Toàn bộ test suite phải pass, bao gồm test đã sửa assertion và test mới.

## Ghi kết quả

`result.md`: dòng đã sửa, test đã sửa (giá trị cũ/mới), test mới, kết quả
build + test.
