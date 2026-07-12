# Task 06 — Đặt STOP order lên Binance TRƯỚC khi breakout xảy ra (không chờ xác nhận rồi mới market)

## Bối cảnh quan trọng — ĐỌC KỸ TRƯỚC KHI SỬA (đã research kỹ, đừng đoán lại từ đầu)

Vấn đề gốc: các detector hiện tại (`src/charts/setups/{bb,rb,arb,irb}.ts`) chỉ phát tín hiệu SAU
KHI nến đã đóng cửa và giá đã thực sự vượt qua mức breakout (ví dụ trong `bb.ts`:
`candles[index].close > block.high`). Vì tín hiệu chỉ có sau khi giá đã vượt mức, khi bot đặt lệnh
STOP tại đúng mức đó lên Binance thì bị từ chối lỗi `-2021 "Order would immediately trigger"` (giá
đã vượt trigger rồi). Giải pháp tạm trước đó là chuyển sang MARKET ngay khi breakout xác nhận —
nhưng user lo ngại trượt giá quá xa so với phân tích.

**Phát hiện quan trọng khi research (Leader đã đọc kỹ code, KHÔNG cần đọc lại từ đầu)**: hạ tầng để
đặt lệnh STOP thật lên Binance và tự chờ khớp **ĐÃ TỒN TẠI SẴN VÀ ĐANG CHẠY**, không cần xây mới:

- `open_positions_volman` đã có cột `binance_entry_order_status`, `binance_entry_order_placed_at`,
  `binance_entry_order_type` — dùng để track 1 lệnh entry LIMIT/STOP đang "working" (chưa khớp)
  trên sàn.
- [`binance-execution-shared.ts`](../../../src/charts/binance-execution-shared.ts) hàm
  `pollPendingEntryOrders` (dòng 850 tại thời điểm viết task này — grep lại để xác nhận nếu code
  đã đổi thêm) — đã tự động kiểm tra trạng thái lệnh entry LIMIT/STOP đang chờ, hủy nếu quá hạn
  (`BINANCE_ENTRY_ORDER_EXPIRY_MINUTES`, hiện set 90 phút trong `.env`). Cơ chế này **đã chạy mỗi
  lần `npm run analyze`** (log "Polling pending entry orders" xuất hiện ở MỌI lần chạy trong phiên
  làm việc này).
- Khi `BINANCE_HONOR_ORDER_TYPE_VOLMAN=true` (hiện đang set `true` trong `.env`) và
  `setup.orderType` là `BUY_STOP`/`SELL_STOP`, `binance-execution-shared.ts` đã tự động đặt lệnh
  entry dạng `STOP_MARKET` qua `placeStopMarketEntryOrder` (không phải MARKET) — dòng 359 tại thời
  điểm viết task này (grep lại `placeStopMarketEntryOrder` để xác nhận nếu file đã đổi thêm).

**Kết luận: KHÔNG CẦN xây hệ thống pending-order mới.** Chỉ cần sửa 1 việc duy nhất: **thời điểm
phát tín hiệu** trong các file detector — tách rời "pattern đã sẵn sàng" (compression/block đã
hình thành, slope EMA đúng hướng) ra khỏi "giá đã breakout" (điều kiện `close > block.high`), và
phát tín hiệu ngay khi pattern sẵn sàng, KHÔNG chờ breakout candle. Khi đó `openBinanceFuturesPosition`
sẽ đặt STOP order thật lên sàn NGAY LÚC pattern sẵn sàng — chờ Binance tự khớp khi giá thật sự chạy
tới, y hệt cách Bob Volman đặt lệnh thật ngoài đời.

**LƯU Ý QUAN TRỌNG — KHÔNG BỎ QUA**: không phải cả 4 setup đều pre-position được dễ như nhau:

- **BB (Block Break)**: hướng lệnh (`direction`) đã được xác định TRƯỚC breakout, từ `classifyTrend`
  (uptrend → LONG, downtrend → SHORT) — KHÔNG phụ thuộc vào việc giá đã breakout hay chưa. Setup
  này pre-position được ngay, đơn giản, chỉ 1 lệnh STOP theo đúng hướng trend.
- **RB, ARB, IRB (Range/Advanced Range/Inside Range Break)**: hướng lệnh hiện tại được xác định
  TỪ chính việc breakout xảy ra theo chiều nào (đọc code: `breaksUp = candles[index].close >
  range.high`, `breaksDown = candles[index].close < range.low` — dùng CHÍNH candle breakout để suy
  ra hướng). Range break theo định nghĩa có thể phá lên HOẶC xuống — không biết trước hướng nào sẽ
  xảy ra. Muốn pre-position thật cho nhóm này cần đặt ĐỒNG THỜI 2 lệnh (buy-stop trên biên trên +
  sell-stop dưới biên dưới — kiểu OCO), rồi hủy lệnh còn lại khi 1 bên khớp — đây LÀ SCOPE LỚN HƠN,
  cần cơ chế huỷ chéo lệnh chưa có sẵn.

## Việc cần làm — CHỈ LÀM CHO BB TRONG TASK NÀY

1. Trong [`src/charts/setups/bb.ts`](../../../src/charts/setups/bb.ts):
   - Đọc kỹ toàn bộ hàm `detectBb` hiện tại trước khi sửa.
   - Tách điều kiện breakout (`breaksUp`/`breaksDown`, dòng ~65-78 theo bản đọc trước — xác nhận
     lại) ra khỏi phần xác định pattern sẵn sàng (trend + slope + block detection, dòng ~19-63).
   - Khi pattern đã sẵn sàng (trend rõ ràng, slope đủ dốc, block hình thành sát EMA20) — **phát
     tín hiệu NGAY tại candle cuối cùng của block** (`triggerIndex = block.endIndex`, KHÔNG phải
     candle breakout), với `entry = direction === "LONG" ? block.high : block.low` (giữ nguyên
     công thức entry/SL/TP hiện có — chỉ đổi thời điểm phát tín hiệu, không đổi công thức giá).
   - Bỏ điều kiện `if (!breaksUp) return null` / `if (!breaksDown) return null` — không cần chờ
     breakout mới trả tín hiệu nữa.
   - **QUAN TRỌNG**: đọc lại toàn bộ `ruleTrace`/`ruleTrace.push(...)` hiện có trong hàm — cập nhật
     message log cho khớp ý nghĩa mới ("Block sẵn sàng, đặt STOP chờ breakout" thay vì "Close đã
     phá Block boundary").

2. **KHÔNG sửa** `rb.ts`, `arb.ts`, `irb.ts` trong task này — 3 setup đó cần thiết kế OCO riêng
   (out of scope, xem mục "Việc KHÔNG được làm").

3. Kiểm tra `setup-backtest.ts` — detector `detectBb` cũng được dùng trong backtest engine. Sau khi
   sửa thời điểm phát tín hiệu, backtest cần đảm bảo vẫn dùng `fillMode="pending"` (đã có sẵn từ
   trước) để mô phỏng đúng: tín hiệu phát ra tại `triggerIndex` mới (cuối block), chờ giá chạm entry
   ở các nến sau — cơ chế `pendingOrder` trong `setup-backtest.ts` (dòng ~137-159) đã xử lý đúng
   việc này, không cần sửa gì thêm ở `setup-backtest.ts`, chỉ cần CHẠY LẠI backtest để xác nhận số
   liệu BB thay đổi hợp lý (không tăng đột biến bất thường).

## Việc KHÔNG được làm

- Không sửa `rb.ts`, `arb.ts`, `irb.ts` — để nguyên hành vi MARKET-sau-breakout hiện tại cho 3
  setup này (chờ task riêng nếu user muốn mở rộng OCO sau).
- Không tự ý đổi `BINANCE_HONOR_ORDER_TYPE_VOLMAN` trong `.env` — giữ nguyên giá trị hiện tại
  (`true`), đây là quyết định của user.
- Không xây thêm bảng DB hay cơ chế polling mới — dùng đúng `pollPendingEntryOrders`/
  `binance_entry_order_status` đã có sẵn.
- Không đổi công thức entry/SL/TP1/TP2 của BB — chỉ đổi THỜI ĐIỂM phát tín hiệu.

## Kiểm tra hoàn thành

1. `npx tsc --noEmit` không lỗi.
2. `npx vitest run` — chú ý các test hiện có cho `detectBb` (`tests/charts/setups.test.ts` hoặc
   tương tự — grep `detectBb` trong `tests/`) rất có thể đang assert `triggerIndex` = candle
   breakout — cần cập nhật test cho khớp hành vi mới (`triggerIndex` = cuối block), KHÔNG xoá test,
   sửa lại assertion.
3. Chạy thử thật (đọc kỹ — hệ đang live trading thật trên testnet):
   ```
   CHART_PRIMARY_TIMEFRAME=H4 npm run analyze
   ```
   hoặc M15, xác nhận nếu có setup BB được phát hiện, log thể hiện đặt STOP_MARKET entry (không
   phải MARKET), và không còn lỗi `-2021` cho setup BB.
4. Chạy `BACKTEST_TIMEFRAME=H4 BACKTEST_FILL_MODE=pending npm run backtest:setups`, so sánh số
   liệu setup BB trước/sau khi sửa — ghi rõ trong `result.md` nếu win rate/avg R thay đổi đáng kể
   (dự kiến: entry sớm hơn 1 nến có thể làm risk (SL distance) hơi khác, cần verify không tạo bug
   khiến risk = 0 hoặc âm).

## Ghi kết quả

Ghi vào `result.md`: diff `bb.ts`, log chạy thử thật, số liệu backtest trước/sau, và xác nhận rõ
ràng: task này CHỈ áp dụng cho BB, RB/ARB/IRB vẫn dùng MARKET-sau-breakout như cũ (để user biết
scope thực tế, tránh hiểu nhầm đã fix cho cả 4 setup).
