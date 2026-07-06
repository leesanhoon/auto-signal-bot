# Task 01: OHLC Data Provider (OANDA v20)

## Bối cảnh
Xem [plan.md](../plan.md) để hiểu bức tranh tổng. Hiện tại `fetchCandleRangeStats` trong
[src/charts/screenshot.ts](../../../src/charts/screenshot.ts) chỉ gọi Yahoo Finance với
`interval=2m&range=1d` — chỉ phục vụ hậu kiểm giá, không đủ lịch sử/độ phân giải/volume thật
để phát hiện pattern hay backtest. Quyết định đã chốt: dùng **OANDA v20 practice REST API**
làm nguồn chính (xem lý do trong plan.md — khớp đúng symbol, có granularity M15/H4/D trực
tiếp không cần resample, có volume thật). Yahoo Finance giữ nguyên làm fallback dự phòng.

Người dùng đã/sẽ tự đăng ký tài khoản OANDA practice và cung cấp 2 biến môi trường:
`OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`. Nếu 2 biến này chưa có trong `.env` khi bạn chạy test
thực tế (không phải unit test có mock), coi như chưa cấu hình — vẫn phải build/test được nhờ
mock, chỉ không gọi API thật.

## Yêu cầu

1. Tạo file mới `src/charts/ohlc-provider.ts`.
2. Export type:
   ```ts
   export type Candle = {
     time: number; // epoch ms, thời điểm mở nến
     open: number;
     high: number;
     low: number;
     close: number;
     volume: number;
   };
   ```
3. Export hàm map symbol nội bộ → OANDA instrument:
   ```ts
   export function toOandaInstrument(symbol: string): string | null;
   ```
   - `"OANDA:EURUSD"` → `"EUR_USD"`, `"OANDA:XAUUSD"` → `"XAU_USD"`, v.v. — tách phần sau dấu
     `:`, chèn `_` giữa ký tự thứ 3 và thứ 4 (3 ký tự đầu là base currency/kim loại).
   - Trả `null` nếu symbol không đúng định dạng `OANDA:XXXYYY` (6 ký tự sau dấu `:`).
4. Export hàm chính:
   ```ts
   export async function fetchOhlcHistory(
     symbol: string,
     timeframe: ChartTimeframe,
     bars: number,
   ): Promise<Candle[] | Error>
   ```
   - Trả `Error` object khi fail (KHÔNG throw), theo chuẩn code standard của project.
   - Đọc `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, và base URL từ env
     (`OANDA_API_BASE_URL`, mặc định `https://api-fxpractice.oanda.com`) — thêm biến này vào
     `src/shared/env.ts` theo đúng pattern các biến env khác đã có trong file đó (đọc file
     trước khi sửa).
   - Nếu thiếu `OANDA_API_TOKEN` hoặc `OANDA_ACCOUNT_ID` → trả `Error` rõ ràng
     (`"OANDA_API_TOKEN/OANDA_ACCOUNT_ID chưa cấu hình"`), KHÔNG throw, KHÔNG gọi Yahoo
     fallback ở bước này (fallback sẽ được gọi bởi call site, không phải trong hàm này —
     giữ hàm này single-purpose).
   - Map `ChartTimeframe` → OANDA `granularity`: `"M15"` → `"M15"`, `"H4"` → `"H4"`,
     `"D1"` → `"D"`.
   - Gọi `GET {baseUrl}/v3/instruments/{instrument}/candles?granularity={g}&count={bars}&price=M`
     với header `Authorization: Bearer {OANDA_API_TOKEN}`.
   - Response OANDA có dạng (rút gọn):
     ```json
     { "candles": [
       { "time": "2024-01-01T00:00:00.000000000Z", "volume": 120,
         "mid": { "o": "1.1000", "h": "1.1010", "l": "1.0990", "c": "1.1005" } }
     ] }
     ```
     Parse `time` (ISO string, có nanosecond — dùng `Date.parse` là đủ, JS tự bỏ phần dư),
     parse `mid.o/h/l/c` bằng `Number(...)`, lấy `volume` trực tiếp.
   - Trả về `Candle[]` sắp xếp tăng dần theo `time`, tối đa `bars` nến gần nhất, đã đóng
     (OANDA trả cả nến đang chạy dở — lọc `candle.complete === true`, chỉ nhận nến đã đóng).
   - Trả `Error` (không throw) nếu response không `ok` (kèm status code trong message) hoặc
     `instrument` không map được (`toOandaInstrument` trả `null`).
5. Thêm cache đơn giản trong-memory theo key `${symbol}:${timeframe}` với TTL phù hợp
   timeframe (M15: 5 phút, H4: 30 phút, D1: 6 giờ) để tránh gọi lại API liên tục.
6. Viết unit test tại `tests/charts/ohlc-provider.test.ts` (Vitest, mirror cấu trúc
   `tests/` hiện có):
   - Test `toOandaInstrument` với các symbol hợp lệ/không hợp lệ.
   - Mock `fetch` global và mock env vars, test parse response OANDA đúng (đặc biệt: lọc bỏ
     nến `complete: false`, parse đúng thứ tự tăng dần theo time).
   - Test trả `Error` khi thiếu env var, khi response không ok, khi symbol không map được.
   - Test cache trả lại dữ liệu cũ trong TTL, gọi lại fetch sau khi hết TTL.

## Không cần làm
- Không cần implement Yahoo fallback trong file này (chỉ cần đảm bảo hàm không throw để call
  site sau này có thể fallback dễ dàng).
- Không cần tích hợp vào `analyzer.ts` hay bất kỳ runner nào khác — subtask sau sẽ dùng.
- Không cần đổi behaviour của `fetchCandleRangeStats` hiện tại trong `screenshot.ts`.
- Không tự bịa API token/account ID để test thật với OANDA — chỉ dùng mock trong unit test.

## Kết quả mong đợi
Ghi vào `result.md` trong cùng thư mục:
- Danh sách file đã tạo/sửa (bao gồm cả `env.ts` nếu có thêm biến mới, và `.env.example` nếu
  project có file này — thêm `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_API_BASE_URL` vào
  đó theo đúng format các biến hiện có).
- Output của `npm run build` và `npm run test -- --run` (phải pass, không được để test cũ
  fail).
- Bất kỳ giả định nào bạn phải tự quyết định — nêu rõ để Lead review.
