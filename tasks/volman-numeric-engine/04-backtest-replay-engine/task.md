# Task 04: Backtest Replay Engine (gate bắt buộc trước cutover)

## Bối cảnh
Xem [plan.md](../plan.md) — subtask này là **gate bắt buộc**: kết quả ở đây quyết định có
được phép cutover (subtask 06) hay không. Khác với
[forex-backtest.ts](../../../src/charts/forex-backtest.ts) hiện tại (chỉ tổng hợp lệnh đã
đóng thật), engine này phải **walk-forward qua lịch sử nến OANDA**, tự giả lập entry/stop/TP
bằng cách chạy lại 7 state machine (subtask 03) trên từng candle quá khứ.

## Yêu cầu

### 1. Replay engine
Tạo file mới `src/charts/setup-backtest.ts`:
```ts
export type SetupBacktestTrade = {
  setup: SetupKind;
  pair: string;
  timeframe: ChartTimeframe;
  direction: "LONG" | "SHORT";
  entryIndex: number;
  entryPrice: number;
  exitIndex: number | null;
  exitPrice: number | null;
  outcome: "tp1" | "tp2" | "stop" | "open_at_end";
  realizedRiskReward: number;
  confidence: number;
};

export type SetupBacktestReport = {
  bySetup: Record<SetupKind, { trades: number; winRate: number; avgRiskReward: number }>;
  byPair: Record<string, { trades: number; winRate: number; avgRiskReward: number }>;
  overall: { trades: number; winRate: number; avgRiskReward: number };
  trades: SetupBacktestTrade[];
};

export function runSetupBacktest(
  candles: Candle[],
  pair: string,
  timeframe: ChartTimeframe,
): SetupBacktestReport
```

Logic walk-forward:
1. Tính `ema20`/`atr14` một lần cho toàn bộ mảng `candles` (dùng hàm subtask 02).
2. Duyệt `index` từ điểm đủ dữ liệu (ví dụ `index >= 30`) đến `candles.length - 1`.
3. Tại mỗi `index`, chạy cả 7 detector (subtask 03) — nếu có `DetectedSignal`, đây là điểm
   "vào lệnh giả lập".
4. **Forward-scan để tìm outcome**: từ `index+1` trở đi, so `High`/`Low` của từng nến kế tiếp
   với `stopLoss`/`takeProfit1`/`takeProfit2` của signal:
   - Nến nào chạm `stopLoss` trước (theo đúng hướng LONG/SHORT) → outcome `"stop"`.
   - Nến nào chạm `takeProfit2` trước → outcome `"tp2"`.
   - Nếu chỉ chạm `takeProfit1` mà chưa chạm `stop`/`tp2` tới hết mảng → outcome `"tp1"`.
   - Nếu quét hết mảng candles mà chưa chạm gì → outcome `"open_at_end"` (loại khỏi thống kê
     win rate, chỉ đếm số lượng).
   - Trong 1 nến chạm cả `stop` và `tp` cùng lúc (nến biên độ lớn) → ưu tiên tính `stop` trước
     (giả định bất lợi/conservative, đúng chuẩn backtest thận trọng).
5. `realizedRiskReward`: `(exitPrice - entryPrice)/(entryPrice - stopLoss)` cho LONG (đảo dấu
   cho SHORT), âm nếu outcome là `"stop"`.
6. Sau khi 1 signal đã vào lệnh tại `index`, **bỏ qua các signal mới cho cùng pair cho đến
   khi lệnh hiện tại đóng** (không chồng lệnh) — dùng biến `activeUntilIndex` để skip.
7. Tổng hợp `bySetup`/`byPair`/`overall`: `winRate = trades có realizedRiskReward > 0 / tổng
   trades có outcome != "open_at_end"`, `avgRiskReward` = trung bình `realizedRiskReward`.

### 2. CLI runner
Tạo file mới `src/charts/setup-backtest-runner.ts` (mirror
[forex-backtest-runner.ts](../../../src/charts/forex-backtest-runner.ts) về cấu trúc CLI):
- Dùng `fetchOhlcHistory` (subtask 01) để lấy tối đa lịch sử cho từng pair trong
  [charts.config.ts](../../../src/charts/charts.config.ts), chạy `runSetupBacktest` cho từng
  pair/timeframe, gộp báo cáo, in ra console (bảng win rate theo setup, theo pair).
- Thêm script vào `package.json`: `"backtest:setups": "tsx src/charts/setup-backtest-runner.ts"`
  (xem cách các script hiện có được định nghĩa, dùng đúng runner tool project đang dùng —
  đọc `package.json` trước khi thêm).

### Unit test
Viết `tests/charts/setup-backtest.test.ts`:
- Fixture `Candle[]` viết tay dựng sẵn 1 tình huống DD rõ ràng, kiểm tra `runSetupBacktest`
  bắt đúng trade, tính đúng outcome (dựng thêm vài nến sau điểm trigger để giá đi tới TP1
  hoặc SL rõ ràng).
- Test trường hợp "chồng lệnh" — 2 signal liên tiếp cùng pair, xác nhận signal thứ 2 bị bỏ qua
  cho đến khi lệnh 1 đóng.
- Test tổng hợp báo cáo (`bySetup`/`byPair`/`overall`) tính đúng winRate/avgRiskReward trên
  tập fixture có kết quả biết trước (tính tay để so khớp).

## Không cần làm
- Không cần chạy thật với OANDA — CLI runner code xong, test dùng fixture, không cần
  `OANDA_API_TOKEN` thật để pass test.
- Không cần tối ưu hiệu năng (backtest chạy 1 lần offline, không phải hot path).
- Không cần so sánh với hiệu năng AI cũ trong task này — đó là bước Lead tự làm sau khi có
  báo cáo (đọc report này rồi đối chiếu thủ công với `performance-tracking.ts` của hệ thống
  cũ).

## Kết quả mong đợi
Ghi vào `result.md`:
- Danh sách file đã tạo/sửa.
- Output `npm run build` và `npm run test -- --run` (pass toàn bộ).
- Output mẫu của `runSetupBacktest` chạy trên fixture (để Lead xem báo cáo có hợp lý không).
- Giả định nào phải tự quyết định (ví dụ cách xử lý nến chạm cả stop và TP cùng lúc) — nêu rõ.
