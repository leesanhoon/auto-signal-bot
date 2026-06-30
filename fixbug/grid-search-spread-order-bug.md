# Bug: grid-search in `evaluateCandidate()` luôn in ra `decay=0.00 overdueBonus=0.00`

## Triệu chứng

Chạy `npm run lottery-backtest`, dòng `best-grid` luôn hiển thị:
```
decay=0.00 overdueBonus=0.00 weightedGap=off spread=0.00
```
Vô lý vì `baseDecay` của các miền là 0.9–0.95 (`DECAY_BY_REGION`), không thể ra 0.00.

`edge` hiển thị (vd Miền Bắc +0.8% → +1.1%, Miền Trung +1.2% → +1.2%, Miền Nam +1.1% → +1.8%) **vẫn đúng/đáng tin** — bug chỉ nằm ở việc hiển thị sai bộ tham số đã chọn, không ảnh hưởng tới việc tính `edge` hay chọn ra candidate tốt nhất.

## File bị lỗi

[src/lottery/lottery-backtest-index.ts](../src/lottery/lottery-backtest-index.ts)

## Nguyên nhân

Hàm `evaluateCandidate()`:
```ts
async function evaluateCandidate(
  historyByWeekday: Record<number, Awaited<ReturnType<typeof loadWeekdayHistory>>>,
  region: LotteryRegion,
  candidate: GridCandidate,
): Promise<GridResult> {
  const reports = WEEKDAYS.map((weekday) => {
    const records = historyByWeekday[weekday] ?? [];
    if (records.length === 0) {
      return runBacktest([], region, 3, 20, { scoring: toScoring(candidate) });
    }
    return runBacktest(records, region, 3, 20, { scoring: toScoring(candidate) });
  });
  const resolved = await Promise.all(reports);
  const combined = sumReports(resolved);
  return { ...candidate, ...combined };   // <-- BUG ở đây
}
```

`sumReports()` trả về 1 object `GridResult` có **sẵn các field placeholder** `decay: 0, overdueBonus: 0, useWeightedExpectedGap: false, stationSpreadWeight: 0` (xem định nghĩa `sumReports`, nó chỉ quan tâm tổng hợp `periodsTested/hits/baselineHits/...`, không biết candidate là gì nên để mặc định 0/false):

```ts
function sumReports(reports: ReturnType<typeof runBacktest>[]): GridResult {
  const totals = reports.reduce(/* ... */);
  return {
    decay: 0,
    overdueBonus: 0,
    useWeightedExpectedGap: false,
    stationSpreadWeight: 0,
    periodsTested: totals.periodsTested,
    hitRate,
    baselineHitRate,
    edge: hitRate - baselineHitRate,
    hits: totals.hits,
    baselineHits: totals.baselineHits,
  };
}
```

Khi spread `{ ...candidate, ...combined }`, vì `combined` đứng **sau** `candidate` trong object spread, các field trùng tên (`decay`, `overdueBonus`, `useWeightedExpectedGap`, `stationSpreadWeight`) của `combined` (toàn giá trị 0/false) **ghi đè lên** giá trị thật của `candidate`. Kết quả: `GridResult` trả về luôn có 4 field tham số bị zero-out, dù `edge`/`hitRate` vẫn tính đúng từ dữ liệu thật (không bị ảnh hưởng vì `sumReports` tính đúng các field đó từ `reports`).

## Cách sửa

Đảo thứ tự spread, hoặc bỏ hẳn 4 field placeholder khỏi `sumReports()` (chỉ nên trả phần "thống kê tổng hợp", không nên có field tham số):

**Cách 1 — đảo thứ tự spread (sửa nhanh nhất, ít rủi ro nhất):**
```ts
return { ...combined, ...candidate };
```

**Cách 2 (khuyến nghị, sạch hơn) — đổi `sumReports()` để không trả field tham số giả, tách `GridResult` thành 2 phần rõ ràng:**
```ts
type AggregatedReport = {
  periodsTested: number;
  hitRate: number;
  baselineHitRate: number;
  edge: number;
  hits: number;
  baselineHits: number;
};

function sumReports(reports: ReturnType<typeof runBacktest>[]): AggregatedReport {
  const totals = reports.reduce(
    (acc, report) => {
      acc.periodsTested += report.periodsTested;
      acc.hits += report.hits;
      acc.baselineHits += report.baselineHits;
      return acc;
    },
    { periodsTested: 0, hits: 0, baselineHits: 0 },
  );

  const hitRate = totals.periodsTested > 0 ? totals.hits / totals.periodsTested : 0;
  const baselineHitRate = totals.periodsTested > 0 ? totals.baselineHits / totals.periodsTested : 0;

  return {
    periodsTested: totals.periodsTested,
    hitRate,
    baselineHitRate,
    edge: hitRate - baselineHitRate,
    hits: totals.hits,
    baselineHits: totals.baselineHits,
  };
}
```
Và trong `evaluateCandidate()`:
```ts
const combined = sumReports(resolved);
return { ...candidate, ...combined };
```
(giờ không còn xung đột field nào vì `AggregatedReport` không có `decay`/`overdueBonus`/...).

Cũng cần sửa nhánh dùng `sumReports()` cho `baseline` trong `main()` — hiện đang gán kết quả vào biến tên `baseline` rồi đọc `baseline.periodsTested`, `baseline.hitRate`, v.v. — các field này không đổi tên nên không bị ảnh hưởng, chỉ cần đảm bảo type `AggregatedReport` (cách 2) vẫn có đủ field đó (có).

## Khuyến nghị: chọn Cách 2

Cách 1 (đảo spread) sửa nhanh nhưng vẫn để `GridResult`/`sumReports` mang field tham số vô nghĩa (luôn là giá trị giả khi gọi từ `main()` cho phần baseline) — dễ tái phát bug tương tự sau này nếu có người spread theo thứ tự khác. Cách 2 tách rõ "thống kê đo lường" (`AggregatedReport`) khỏi "tham số đang test" (`GridCandidate`), không còn field trùng tên nên không thể bị ghi đè nhầm nữa.

## Kiểm thử sau khi sửa

1. Chạy lại `npm run lottery-backtest`
2. Xác nhận dòng `best-grid` của cả 3 miền in ra `decay=` gần baseline (vd 0.87–0.98 tuỳ miền), **không còn `0.00`**
3. Xác nhận `edge` của `best-grid` không đổi so với trước khi sửa (vì bug chỉ ở phần hiển thị tham số, không ảnh hưởng tính `edge`) — nếu `edge` đổi thì có nghĩa sửa sai, cần xem lại
4. Chạy `npx tsc --noEmit` đảm bảo không lỗi type sau khi đổi type `GridResult`/thêm `AggregatedReport`
