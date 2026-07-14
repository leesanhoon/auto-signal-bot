# Chart Symbols → Database + Chart-Render Failure Alert

## Bối cảnh

Danh sách symbol quét (`BASE_CHARTS` trong `src/charts/volman-charts.config.ts`) hiện đang hardcode ~180 dòng trong code (crypto qua Binance, forex/vàng qua OANDA), gồm cả các dòng bị comment tạm tắt. Mỗi lần muốn bật/tắt/thêm/sửa symbol phải sửa code + deploy lại. Người dùng muốn chuyển sang lưu trong Supabase (đã dùng sẵn cho toàn bộ phần còn lại của app) để cập nhật trực tiếp qua Dashboard, không cần đụng code.

Trong lúc audit danh sách hiện tại để chuẩn bị migrate, phát hiện:
- Một số dòng crypto trùng lặp: `BLUR/USDT`, `PIXEL/USDT`, `MOVEZ/USDT` xuất hiện 2 lần.
- Một số dòng dùng ticker sai/không tồn tại trên Binance: `STARKNET/USDT` (ticker thật là `STRK`, đã có sẵn `STRK/USDT`), `APTOS/USDT` (trùng nghĩa với `APT/USDT` đã có), `DOGECOIN/USDT` (trùng nghĩa với `DOGE/USDT` đã có), `HOKKAIDU/USDT` (symbol gõ sai thành `HOKKAIIUSDT`).
- Không có cơ chế nào đảm bảo symbol được thêm vào thực sự giao dịch được trên Binance Futures (nơi bot auto-track/auto-trade thật) — dữ liệu sai này lẽ ra không nên có trong danh sách quét.

Đồng thời, người dùng cũng chỉ ra lỗi `"Render chart batch failed, fallback to text-only"` (`src/shared/telegram-volman.ts:473`) hiện chỉ log warn nội bộ, không có cảnh báo Telegram — im lặng thất bại giống bug Playwright-chưa-cài đã ghi nhận trước đó (`docs/superpowers/specs/2026-07-14-volman-atr-snapshot-consistency-design.md`, phần "Ngoài phạm vi").

## Mục tiêu

1. Lưu danh sách symbol quét trong Supabase, sửa/thêm/tắt được qua Dashboard, không cần sửa code.
2. Đảm bảo symbol crypto (`BINANCE:`) được đưa vào hệ thống thực sự tradeable trên Binance Futures — cả lúc migrate dữ liệu ban đầu lẫn khi cần verify lại về sau.
3. Không để lỗi render chart batch âm thầm bị nuốt — phải có cảnh báo Telegram khi xảy ra.

## Ngoài phạm vi

- Không thêm cơ chế chặn tự động khi thêm symbol qua Supabase Dashboard (Dashboard không chạy code của app). Việc đảm bảo symbol hợp lệ khi thêm mới dựa vào script verify chạy tay (mục D).
- Không đổi logic lọc weekend cho symbol `OANDA:` (đóng cửa cuối tuần) — giữ nguyên như hiện tại, chỉ đổi nguồn dữ liệu đầu vào từ hardcode sang DB.
- Không xử lý các bug khác đã liệt kê "Ngoài phạm vi" trong spec ATR snapshot (Playwright chưa cài, Binance position sizing, symbol Forex format sai cho EMA-exit, ngưỡng SB/FB) — các bug đó vẫn ngoài phạm vi.

## Thiết kế

### A. Bảng `chart_symbols_volman`

Cột:
- `id bigint generated always as identity primary key`
- `name text not null` — vd `"BTC/USDT"`, hiển thị trong chart title.
- `symbol text not null unique` — vd `"BINANCE:BTCUSDT"`, `"OANDA:XAUUSD"`.
- `category text` — `"crypto"`, `"commodity"`, `"major"`, `"cross"` (theo đúng nhóm comment trong file gốc), có thể null.
- `is_active boolean not null default true`.
- `created_at timestamptz not null default now()`.

Migration: `supabase/migrations/<timestamp>_create_chart_symbols_volman.sql`, theo đúng convention đặt tên/format các migration hiện có trong `supabase/migrations/`.

### B. Repository `src/charts/chart-symbols-repository-volman.ts`

```
loadActiveChartSymbols(): Promise<Array<{ name: string; symbol: string }>>
```
- Query `chart_symbols_volman` với `is_active = true`, order theo `id` (giữ thứ tự insert cho ổn định/dễ debug log).
- Lỗi Supabase hoặc kết quả rỗng → throw. Không fallback về danh sách hardcode nào — mỗi lần chạy (`npm run analyze`, các runner khác) là một process mới nên fail-fast an toàn hơn scan với danh sách sai/thiếu.

### C. Sửa `src/charts/volman-charts.config.ts`

- Xoá mảng `BASE_CHARTS` hardcode.
- Thêm:
  ```
  let cachedCharts: ChartConfig[] | undefined;

  export async function getCharts(): Promise<ChartConfig[]> {
    if (cachedCharts) return cachedCharts;
    const baseSymbols = await loadActiveChartSymbols();
    cachedCharts = baseSymbols
      .filter((base) => {
        const dayOfWeek = new Date().getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        return !(isWeekend && base.symbol.startsWith("OANDA:"));
      })
      .flatMap((base) =>
        TIMEFRAME_CONFIGS.map((tf) => chart(base.name, base.symbol, tf.timeframe, tf.interval)),
      );
    return cachedCharts;
  }
  ```
  (Giữ nguyên logic lọc weekend hiện có, chỉ đổi nguồn `BASE_CHARTS` → `loadActiveChartSymbols()`.)
- `getChartsForTimeframeMode` chuyển thành `async`, gọi `await getCharts()` bên trong thay vì đọc `CHARTS` trực tiếp.
- `buildChartHtml` giữ nguyên (pure function, không phụ thuộc DB).
- Memoize ở cấp module là đủ vì mỗi lệnh `npm run ...` chạy trong 1 process riêng, không phải server sống lâu — không cần TTL/refresh giữa các lần gọi trong cùng 1 lần chạy.

### D. Cập nhật các nơi gọi `CHARTS` / `getChartsForTimeframeMode`

Toàn bộ các nơi này đã nằm trong hàm `async` sẵn, chỉ đổi cơ học `CHARTS` → `await getCharts()`:
- `src/charts/index.ts` (2 chỗ dùng `CHARTS`, 1 chỗ `getChartsForTimeframeMode`)
- `src/charts/check-open-trades-runner-volman.ts`
- `src/charts/check-pending-orders-runner-volman.ts`
- `src/charts/setup-backtest-runner.ts`
- `src/charts/setup-backtest-compare-runner.ts`
- `tests/charts/check-open-trades-runner-volman.test.ts` — cập nhật mock (mock `getCharts`/repository thay vì mock giá trị `CHARTS` tĩnh).

### E. Seed dữ liệu ban đầu — `src/scripts/seed-chart-symbols.ts` (one-off)

Script tsx chạy tay 1 lần để đổ toàn bộ danh sách hiện có trong `volman-charts.config.ts` (bản trước khi xoá `BASE_CHARTS`) vào bảng mới:

- Với mỗi symbol bắt đầu bằng `BINANCE:`: strip prefix, gọi `getExchangeInfoFilters(strippedSymbol)` (đã có sẵn trong `src/charts/binance-futures-client.ts`, gọi `/fapi/v1/exchangeInfo` — public endpoint, không cần API key). Nếu trả về `Error` (symbol không tồn tại trên Binance Futures) → **bỏ qua hoàn toàn, không insert row này**. Log ra console danh sách symbol bị loại kèm lý do.
- Với mỗi symbol bắt đầu bằng `OANDA:`: không qua check Futures, insert bình thường.
- Dòng đang bị comment `//` trong file gốc (các cross pairs tạm tắt) → vẫn insert nhưng `is_active = false`.
- `category` gán theo đúng nhóm comment gốc: `"crypto"` (Binance spot section), `"commodity"` (Commodities), `"major"` (Major pairs), `"cross"` (Cross pairs / Additional volatile crosses).
- Dùng `upsert` theo `symbol` để chạy lại an toàn (idempotent) trong lúc test script trước khi chạy thật.
- Sau khi chạy xong và verify dữ liệu trong Supabase, xoá `BASE_CHARTS` khỏi `volman-charts.config.ts` (đã làm ở mục C) và có thể xoá file script này.

Kỳ vọng: các dòng trùng lặp (`BLUR`, `PIXEL`, `MOVEZ` xuất hiện 2 lần) sẽ tự động chỉ còn 1 bản ghi nhờ `symbol unique` + `upsert`. Các ticker sai (`STARKNET/USDT`, `APTOS/USDT`, `DOGECOIN/USDT`, `HOKKAIDU/USDT`) sẽ bị loại vì không pass Binance Futures exchangeInfo check.

### F. Script verify định kỳ — `npm run verify:chart-symbols`

Script giữ lại lâu dài (khác với script seed one-off), dùng sau khi bạn tự thêm/sửa symbol trên Supabase Dashboard:

- Load toàn bộ symbol `BINANCE:*` đang `is_active = true` từ `chart_symbols_volman`.
- Với từng symbol, gọi `getExchangeInfoFilters()` để xác nhận vẫn tồn tại/tradeable trên Binance Futures.
- Nếu có symbol không pass:
  - In danh sách ra console (symbol + lý do).
  - Gửi cảnh báo Telegram qua `notifyError("Verify chart symbols", ...)` (hàm có sẵn trong `src/shared/telegram-client.ts`) liệt kê các symbol lỗi, để người dùng biết vào Dashboard sửa/tắt.
- Không tự động sửa DB — chỉ báo, người dùng tự quyết định qua Dashboard.
- Thêm vào `package.json`: `"verify:chart-symbols": "tsx src/scripts/verify-chart-symbols.ts"`.

### G. Cảnh báo khi render chart batch thất bại

`src/shared/telegram-volman.ts`, trong catch block hiện tại (dòng ~472-477):

```
} catch (err) {
  logger.warn("Render chart batch failed, fallback to text-only", {
    error: err instanceof Error ? err.message : String(err),
  });
  await notifyError("Render chart batch (Volman)", err);
  chartBuffers = [];
}
```

- Import `notifyError` từ `../shared/telegram-client.js` (file đã import `sendMessage`, `telegramNotifier` từ cùng module — thêm `notifyError` vào cùng import).
- Giữ nguyên toàn bộ flow fallback text-only phía sau — không đổi hành vi gửi setup, chỉ thêm cảnh báo Telegram để lỗi không còn âm thầm.
- Không rate-limit/gộp cảnh báo — mỗi lần render batch fail là 1 lần cảnh báo, vì lỗi này hiếm và mỗi lần xảy ra đều đáng để biết ngay (đây chính là lỗi Playwright-chưa-cài từng khiến chart im lặng biến mất).

## Testing

- Unit test cho `getCharts()`/`getChartsForTimeframeMode` (mock `loadActiveChartSymbols`): trả đúng danh sách active, áp đúng lọc weekend cho `OANDA:`, memoize đúng (gọi 2 lần chỉ query DB 1 lần).
- Unit test `loadActiveChartSymbols`: throw khi Supabase lỗi hoặc trả rỗng.
- Cập nhật test hiện có đang mock `CHARTS` tĩnh (`tests/charts/check-open-trades-runner-volman.test.ts`) sang mock nguồn dữ liệu mới.
- Test cảnh báo Telegram khi render chart batch fail: mock `renderSetupChartsBatch` throw, assert `notifyError` được gọi đúng scope.
- Script seed và verify không cần unit test (script one-off / vận hành tay) nhưng cần chạy thử trên Supabase thật (hoặc branch/staging) trước khi seed vào production, và xác nhận qua log số symbol bị loại có khớp kỳ vọng (các ticker sai đã liệt kê ở trên).
