# Task 03: In bySetup và byGrade tổng hợp ra console output

File duy nhất được sửa: `src/charts/smc-backtest-runner.ts`
KHÔNG sửa `src/charts/smc/smc-backtest.ts` (report đã có sẵn field cần dùng, không cần đổi kiểu dữ liệu). KHÔNG sửa test. KHÔNG commit.

Task này độc lập với 01/02 — có thể làm song song, không phụ thuộc.

## Bối cảnh

`SmcBacktestReport` (định nghĩa trong `src/charts/smc/smc-backtest.ts`) đã có field `bySetup`, `byGrade`, `bySetupStats`, `trades` — nhưng các field này được tính RIÊNG CHO TỪNG PAIR (mỗi lần gọi `runSmcBacktest` chỉ xử lý 1 pair). Runner hiện tại (`main()` trong `smc-backtest-runner.ts`) chỉ log summary tổng theo outcome (tp1/tp2/.../stop), không gộp bySetup/byGrade qua tất cả các pairs.

## Việc cần làm

Trong `src/charts/smc-backtest-runner.ts`, thêm hàm tổng hợp bySetup/byGrade từ TOÀN BỘ trades của tất cả pairs (không phải từ field `bySetup` per-report, vì field đó chỉ tính trên 1 pair — phải tự gom `report.trades` của mọi report lại):

```ts
function summarizeBySetupAndGrade(reports: SmcBacktestReport[]) {
  const allTrades = reports.flatMap((r) => r.trades);
  const closedTrades = allTrades.filter((t) => t.outcome !== "open_at_end" && t.outcome !== "expired");

  function bucket(items: typeof closedTrades) {
    const wins = items.filter((t) => t.realizedRiskReward > 0);
    return {
      trades: items.length,
      winRatePct: items.length ? round((wins.length / items.length) * 100) : 0,
      avgRiskReward: items.length ? round(items.reduce((s, t) => s + t.realizedRiskReward, 0) / items.length) : 0,
    };
  }

  const bySetup: Record<string, ReturnType<typeof bucket>> = {};
  for (const setup of new Set(closedTrades.map((t) => t.setup))) {
    bySetup[setup] = bucket(closedTrades.filter((t) => t.setup === setup));
  }

  const byGrade: Record<string, ReturnType<typeof bucket>> = {};
  for (const trade of closedTrades) {
    if (!trade.grade) continue;
    if (!byGrade[trade.grade]) byGrade[trade.grade] = bucket(closedTrades.filter((t) => t.grade === trade.grade));
  }

  return { bySetup, byGrade };
}
```

(Hàm `round` đã có sẵn trong file — dùng lại, không định nghĩa trùng.)

Gọi hàm này trong `main()` sau khi vòng lặp pairs kết thúc, và thêm vào object JSON in ra ở `console.log(JSON.stringify(...))` cuối hàm `main()` — thêm field mới `bySetup` và `byGrade` ngang hàng với `summary` và `pairs` hiện có:

```ts
console.log(
  JSON.stringify(
    {
      timeframe,
      bars,
      summary: summarizeReports(reports),
      bySetup: summarizeBySetupAndGrade(reports).bySetup,
      byGrade: summarizeBySetupAndGrade(reports).byGrade,
      pairs: pairSummaries,
    },
    null,
    2,
  ),
);
```

(Tránh gọi hàm 2 lần — gán kết quả vào 1 biến trước rồi destructure, tối ưu nhỏ nhưng không bắt buộc.)

## Verification (bắt buộc, ghi vào result.md)

```bash
npm run build
npm run test
npm run backtest:smc
```

Ghi vào result.md: đoạn `bySetup` và `byGrade` thật từ output, xác nhận có ít nhất 2 setup khác nhau và grade A/B/C (tuỳ dữ liệu thực tế) xuất hiện trong output.

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục, không đoán.
