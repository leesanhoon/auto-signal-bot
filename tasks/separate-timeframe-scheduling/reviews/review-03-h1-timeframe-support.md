# Review: Task 03 — h1-timeframe-support

## Verdict: CHANGES_REQUIRED (đã tự vá bởi Lead — thiếu 1 chỗ quan trọng ngoài scope task.md)

Không có `result.md` (giống Task 02, chỉ commit không ghi result — nhắc lại yêu cầu quy trình).

## Việc đúng

- `volman-charts.config.ts`: thêm `{ timeframe: "H1", interval: "60" }` vào `TIMEFRAME_CONFIGS` —
  đúng mã interval TradingView cho khung 1 giờ.
- Xác nhận đúng: `ohlc-provider.ts` **đã có sẵn** mapping H1 (`binanceCode: "1h"`,
  `twelveDataCode: "1h"`) từ trước — Worker không cần sửa, ghi chú đúng trong commit message.
- `setup-backtest-runner.ts` và `setup-backtest-compare-runner.ts`: thêm `"H1"` vào
  `VALID_TIMEFRAMES` ở cả 2 file — đúng yêu cầu task.md.
- Đã verify thật: `BACKTEST_TIMEFRAME=H1 BACKTEST_BARS=100 npm run backtest:setups` — Lead chạy lại,
  fetch dữ liệu H1 thật từ Binance thành công cho nhiều cặp, không lỗi "Invalid interval".

## Gap nghiêm trọng — NGOÀI SCOPE task.md gốc, ĐÃ ĐƯỢC LEAD FIX

`task.md` (do Lead viết) chỉ yêu cầu verify qua lệnh **backtest** (`BACKTEST_TIMEFRAME=H1`), dùng
`parseBacktestTimeframe()` trong `setup-backtest-runner.ts` — hàm này ĐỘC LẬP với hàm thực sự dùng
trong pipeline **live** (`npm run analyze`). Lead khi review đã chủ động chạy thử thêm
`CHART_PRIMARY_TIMEFRAME=H1 npm run analyze` (vì đây là mục tiêu cuối cùng của cả plan — 3 job live
M15/H1/H4) và phát hiện:

```ts
// src/charts/volman-config-env.ts — TRƯỚC khi fix
export function getConfiguredChartPrimaryTimeframe(): ChartTimeframe {
  const raw = process.env.CHART_PRIMARY_TIMEFRAME?.trim().toUpperCase();
  if (raw === "M15" || raw === "H4" || raw === "D1") {  // <-- thiếu "H1"
    return raw as ChartTimeframe;
  }
  return "M15";
}
```

`CHART_PRIMARY_TIMEFRAME=H1` bị âm thầm rơi về mặc định `"M15"` — pipeline live **chưa bao giờ
thực sự chạy H1** dù task 03 tự báo cáo "H1 timeframe support" hoàn tất. Đây là lỗi im lặng nguy
hiểm nhất (không throw, không log warning, chỉ lặng lẽ dùng sai timeframe) — nếu 1 trong 3 job
Task Scheduler (Task 05) dùng `CHART_PRIMARY_TIMEFRAME=H1`, nó sẽ thực chất chạy trùng M15 mà
không ai biết.

**Đây là lỗi trong chính task.md của Lead** (không yêu cầu Worker kiểm tra hàm này vì Lead không
biết nó tồn tại lúc viết task.md) — không đổ lỗi cho Worker, nhưng cần ghi nhận để rút kinh nghiệm
quy trình viết task.md: luôn `grep` toàn bộ danh sách whitelist timeframe (`"M15"`,
`ChartTimeframe`, v.v.) trước khi khẳng định "chỉ cần sửa N chỗ này".

### Fix đã áp dụng

`volman-config-env.ts` — thêm `raw === "H1"` vào điều kiện whitelist.

### Verify sau khi fix

```
CHART_PRIMARY_TIMEFRAME=H1 npm run analyze
```
Log xác nhận `"analysisTimeframe": "H1"` (trước đó luôn là `"M15"` dù đã set H1). `npx tsc --noEmit`
sạch.

## Lỗi khác quan sát được khi chạy thử — KHÔNG liên quan Task 03, đã biết từ trước

Log có vài dòng `ERROR ... code -2021 Order would immediately trigger` cho RB/ARB/IRB (ví dụ
ZEC/USDT, CRV/USDT). Đây là vấn đề đã ghi nhận trước đó trong phiên làm việc (chỉ Task 06/BB mới
pre-position được, RB/ARB/IRB vẫn vào STOP-sau-breakout nên bị lỗi này) — **không phải regression
của Task 03**, không cần Worker xử lý ở đây.

## Trạng thái cuối

Task 03 nay đã hoàn thành thật cho cả backtest LẪN live pipeline. Không cần Worker làm lại.
