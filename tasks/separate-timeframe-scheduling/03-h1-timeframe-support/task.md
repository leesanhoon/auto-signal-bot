# Task 03 — Thêm hỗ trợ đầy đủ timeframe H1

## Bối cảnh

Dự án hiện hỗ trợ M15, H4, D1 cho hệ Volman (fetch OHLC, backtest, chart config). Type
`ChartTimeframe` trong [`src/charts/chart-types-common.ts`](../../../src/charts/chart-types-common.ts)
đã khai báo `"M15" | "M30" | "H1" | "H4" | "D1"` — H1 đã có trong TYPE nhưng CHƯA có mapping
interval thực tế để fetch dữ liệu nến. Task này bổ sung phần còn thiếu để H1 chạy được thật sự,
không chỉ tồn tại trên type.

## Việc cần làm

1. Trong [`src/charts/volman-charts.config.ts`](../../../src/charts/volman-charts.config.ts):
   - Tìm mảng `TIMEFRAME_CONFIGS` (hiện có D1→"D", H4→"240", M15→"15" — đọc kỹ format trước khi
     thêm, đây là mã interval TradingView-style). Thêm entry cho H1. Tra cứu: mã interval
     TradingView cho khung 1 giờ là `"60"` (theo phút). Xác nhận lại bằng cách đọc comment/context
     xung quanh code hiện có trước khi thêm, KHÔNG đoán nếu không chắc — nếu nghi ngờ, ghi rõ vào
     `blocked.md`.

2. Trong [`src/charts/ohlc-provider.ts`](../../../src/charts/ohlc-provider.ts):
   - Tìm nơi định nghĩa mapping timeframe → mã interval cho Binance (`binanceCode`, ví dụ
     `"15m"`, `"4h"`, `"1d"`) và cho TwelveData (`twelveDataCode`). Thêm entry cho `"H1"` →
     Binance `"1h"`, TwelveData interval tương ứng cho 1 giờ (kiểm tra TwelveData docs quy ước
     đặt tên interval của các entry hiện có — ví dụ nếu H4 dùng `"4h"` thì H1 dùng `"1h"`, giữ
     đúng format/casing nhất quán với các entry khác trong cùng mapping).

3. Trong [`src/charts/setup-backtest-runner.ts`](../../../src/charts/setup-backtest-runner.ts) và
   [`src/charts/setup-backtest-compare-runner.ts`](../../../src/charts/setup-backtest-compare-runner.ts):
   - Tìm `VALID_TIMEFRAMES` (hiện là `["M15", "H4", "D1"]`) — thêm `"H1"` vào mảng này ở CẢ HAI
     file (giữ đồng bộ giữa 2 runner).

4. Kiểm tra [`src/charts/deterministic-pipeline.ts`](../../../src/charts/deterministic-pipeline.ts)
   có logic riêng theo `timeframe === "D1"` (session/ATR filter) — H1 sẽ tự động rơi vào nhánh
   `else` hiện có (chỉ check ATR floor, không có session-hour vì session-hour đã bị bỏ trước đó —
   xác nhận lại bằng cách đọc code, không cần sửa gì ở file này nếu nhánh else đã tổng quát đúng
   cho mọi timeframe không phải D1).

## Việc KHÔNG được làm

- Không thêm H1 vào hệ SMC (`smc-*.ts`, `chart-types-smc.ts`) — task này chỉ scope cho Volman.
- Không đổi giá trị interval của các timeframe đã có (D1/H4/M15) — chỉ thêm, không sửa dòng cũ.
- Không bật H1 làm mặc định ở bất kỳ đâu (`.env`, `.env.example`) — chỉ cần H1 CHẠY ĐƯỢC khi được
  chọn tường minh qua `CHART_PRIMARY_TIMEFRAME=H1`, không đổi default hiện tại (H4).

## Kiểm tra hoàn thành

1. `npx tsc --noEmit` không lỗi.
2. Chạy thử thật: `CHART_PRIMARY_TIMEFRAME=H1 npm run backtest:setups` (dùng
   `BACKTEST_TIMEFRAME=H1`) — phải fetch được dữ liệu nến H1 thật từ Binance cho ít nhất 1-2 cặp
   (không cần chạy full 64 cặp, dùng để xác minh mapping interval đúng, không lỗi "Invalid
   interval" từ Binance API).
3. `npx vitest run` — pass toàn bộ, không có test nào hard-code danh sách timeframe cũ bị vỡ vì
   thêm entry mới (nếu có test kiểu `expect(VALID_TIMEFRAMES).toEqual([...])` cứng — cập nhật test
   đó cho khớp danh sách mới, đừng xoá test).

## Ghi kết quả

Ghi vào `result.md`: mã interval H1 đã dùng cho từng nơi (TradingView/Binance/TwelveData), output
thật của lệnh backtest thử nghiệm H1, kết quả tsc + vitest.
