# Task 07 — Swing trailing SL thật cho live (thay vì khoá cứng breakeven sau TP1)

## Bối cảnh

Phụ thuộc: không phụ thuộc Task 06 (độc lập), nhưng nên làm SAU Task 01-05 (tránh conflict với
thay đổi schema/loadOpenPositions).

**Hiện trạng**: khi TP1 khớp, [`binance-execution-shared.ts`](../../../src/charts/binance-execution-shared.ts)
hàm `reconcileBinancePosition` (đoạn xử lý TP1 filled, quanh dòng 709-800 tại thời điểm viết task
này — grep `!alreadyPartial && position.binanceTp1OrderId` để xác nhận vị trí chính xác) hủy SL cũ
và đặt SL mới CỐ ĐỊNH tại giá entry (breakeven) — sau đó SL này KHÔNG BAO GIỜ dời tiếp nữa cho tới
khi TP2 khớp hoặc giá quét ngược về entry.

**Nguyên bản Bob Volman**: sau khi chốt lời một phần tại TP1, phần vị thế còn lại được quản lý bằng
cách **trail SL theo cấu trúc** — dời SL siết dần theo đáy (LONG) / đỉnh (SHORT) của các nến gần
nhất đã đóng, KHÔNG khoá cứng 1 mức. Đây là cách "để lợi nhuận chạy" thật sự trong phương pháp gốc.

**Đã có sẵn logic tham chiếu** trong backtest engine — hàm `scanOutcomeSwingTrail` trong
[`setup-backtest.ts`](../../../src/charts/setup-backtest.ts) (dòng ~423 tại thời điểm viết task
này): sau khi TP1 hit, tính `swingLow`/`swingHigh` trên `swingLookback` nến gần nhất (mặc định 3),
chỉ dời SL SIẾT LẠI (never nới lỏng — `if (swingLow > currentStop) currentStop = swingLow`). Dùng
CHÍNH logic này làm tham chiếu khi viết bản live (không cần giống 100% dòng code vì backtest chạy
trên mảng candles có sẵn, còn live phải fetch OHLC qua API mỗi cycle — nhưng CÔNG THỨC swing
low/high phải giống hệt).

## Việc cần làm

1. Trong `binance-execution-shared.ts`, tìm đoạn xử lý TP1 filled (nhánh
   `!alreadyPartial && position.binanceTp1OrderId` rồi `tp1Status.status === "FILLED"`) — đây vẫn
   giữ nguyên logic dời SL về breakeven LẦN ĐẦU (khi TP1 vừa khớp) như hiện tại, KHÔNG đổi.

2. Thêm nhánh MỚI: khi vị thế đã ở trạng thái `alreadyPartial === true` (tức TP1 đã khớp từ trước,
   đang trong giai đoạn chờ TP2) VÀ **SL hiện tại chưa bị khớp** — mỗi lần `reconcileBinancePosition`
   chạy (tức mỗi cycle check-open-trades), tính lại swing low/high:
   - Cần fetch N nến gần nhất đã đóng cho symbol/timeframe của position (dùng
     `fetchOhlcHistory` từ [`ohlc-provider.ts`](../../../src/charts/ohlc-provider.ts) — xem cách
     `deterministic-pipeline.ts` gọi hàm này làm mẫu, KHÔNG dùng `fetchCandleRangeStats` từ
     `screenshot.ts` — đó là hàm của pipeline AI-vision cũ, không dùng cho hệ deterministic).
   - `swingLookback` = 3 nến (giống default trong `scanOutcomeSwingTrail`), có thể đọc từ env
     `BACKTEST_SWING_LOOKBACK` KHÔNG — đây là backtest-only, tạo env riêng cho live nếu cần:
     `POSITION_SWING_TRAIL_LOOKBACK` (mặc định 3).
   - LONG: `newSwingStop = min(low của N nến gần nhất)`. Nếu `newSwingStop > currentStop` (SL hiện
     tại) → hủy SL cũ, đặt SL mới tại `newSwingStop` (làm tròn theo tickSize, dùng
     `roundToTickSize` đã có sẵn trong file).
   - SHORT: `newSwingStop = max(high của N nến gần nhất)`. Nếu `newSwingStop < currentStop` → dời
     tương tự.
   - Dùng lại ĐÚNG pattern "hủy SL cũ trước, đặt SL mới sau, retry 3 lần nếu fail, alert Telegram
     khẩn cấp nếu vẫn fail" đã viết cho bước dời breakeven (copy cấu trúc, đừng viết lại từ đầu).
   - Nếu `newSwingStop` không tốt hơn SL hiện tại (không siết được) — KHÔNG làm gì, giữ nguyên SL,
     không gọi API thừa.

3. Trường field DB cần thêm (nếu chưa có — kiểm tra `open_positions_volman` schema trước khi đoán):
   - Cần lưu SL hiện tại đang ở mức nào (có thể đã có cột `trailing_stop_loss` — kiểm tra schema,
     nếu có thì dùng lại, không tạo cột trùng chức năng).

4. **QUAN TRỌNG — quyết định cần Leader duyệt lại nếu phát sinh khi code**: việc fetch OHLC thêm
   mỗi cycle cho MỖI vị thế đang ở giai đoạn trailing sẽ tốn thêm API call (rate limit). Nếu số
   lượng vị thế đồng thời lớn, cân nhắc thêm rate-limit guard hoặc ghi rõ trong `result.md` để
   Leader đánh giá, KHÔNG tự ý bỏ qua rate limit hiện có (`BINANCE_RATE_LIMIT_RPM`,
   `withConfiguredRateLimit` đã dùng trong `binance-futures-client.ts`).

## Việc KHÔNG được làm

- Không đổi logic dời breakeven LẦN ĐẦU khi TP1 vừa khớp — chỉ THÊM bước trailing tiếp theo sau đó.
- Không áp dụng trailing cho giai đoạn TRƯỚC khi TP1 khớp (SL vẫn giữ nguyên vị trí gốc cho tới TP1,
  đúng hành vi hiện tại).
- Không sửa `setup-backtest.ts` (logic tham chiếu, không phải nơi cần sửa — task này chỉ sửa live).
- Không nới lỏng SL (chỉ được siết chặt hơn, không bao giờ dời SL ra xa hơn vị trí hiện tại).
- Không tự ý đổi `partialClosePercent`/công thức TP1/TP2 — chỉ đổi cách quản lý SL SAU TP1.

## Kiểm tra hoàn thành

1. `npx tsc --noEmit` không lỗi.
2. `npx vitest run` — pass toàn bộ. Thêm test mới cho nhánh trailing (mock OHLC trả về giá trị cụ
   thể, verify SL mới được tính đúng công thức swing low/high, verify KHÔNG gọi API dời SL khi
   swing không tốt hơn SL hiện tại).
3. Test thủ công logic: viết 1 unit test độc lập so sánh kết quả tính swing low/high giữa hàm mới
   trong `binance-execution-shared.ts` và `scanOutcomeSwingTrail` trong `setup-backtest.ts` trên
   CÙNG 1 bộ dữ liệu nến giả lập — phải cho ra CÙNG kết quả (đảm bảo công thức nhất quán giữa
   backtest và live, tránh lặp lại sai lầm "backtest không khớp live" đã gặp trước đây trong dự án
   này).

## Ghi kết quả

Ghi vào `result.md`: diff `binance-execution-shared.ts`, test mới đã thêm, kết quả so sánh công
thức swing với backtest, và đánh giá rủi ro rate-limit nếu có nhiều vị thế trailing đồng thời.
