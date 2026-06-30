# Mở rộng grid-search + áp dụng tham số mới cho Miền Bắc/Nam

## Context

Sau khi sửa bug ghi đè tham số trong grid-search ([fixbug/grid-search-spread-order-bug.md](grid-search-spread-order-bug.md) — đã áp dụng), chạy lại `npm run lottery-backtest` cho kết quả thật:

```
Miền        Thứ        Kỳ test   Hit-rate   Baseline   Edge
mien-bac    baseline   888       7.4%       6.7%       +0.8%
mien-bac    best-grid  888       7.8%       6.7%       +1.1%
  decay=0.98 overdueBonus=0.20 weightedGap=off spread=0.00
mien-trung  baseline   898       12.7%      11.5%      +1.2%
mien-trung  best-grid  898       12.7%      11.5%      +1.2%
  decay=0.90 overdueBonus=0.20 weightedGap=off spread=0.00
mien-nam    baseline   898       15.8%      14.7%      +1.1%
mien-nam    best-grid  898       16.5%      14.7%      +1.8%
  decay=0.90 overdueBonus=0.20 weightedGap=off spread=0.00
```

Quyết định:
1. **Mở rộng range grid-search** — range hiện tại quá hẹp (`decay ±0.03`, `overdueBonus ±0.1`, `stationSpreadWeight` chỉ test [0, 0.05]) khiến Miền Trung không tìm ra cải thiện nào, và chưa rõ `useWeightedExpectedGap`/`stationSpreadWeight` có thực sự vô dụng hay chỉ do test range hẹp.
2. **Áp dụng ngay vào production cho Miền Bắc và Miền Nam** — 2 miền này đã có bằng chứng backtest rõ ràng (`edge` tăng đáng kể), không cần chờ thêm. **Miền Trung giữ nguyên** (chưa có bằng chứng cải thiện), chỉ áp dụng sau khi mở rộng grid-search xác nhận có lợi.

## Phần 1 — Mở rộng grid-search

File: [src/lottery/lottery-backtest-index.ts](../src/lottery/lottery-backtest-index.ts), hàm `makeGridCandidates()`.

**Hiện tại:**
```ts
function makeGridCandidates(region: LotteryRegion): GridCandidate[] {
  const baseDecay = DECAY_BY_REGION[region];
  const baseBonus = OVERDUE_BONUS_BY_REGION[region];
  const decays = [baseDecay - 0.03, baseDecay, baseDecay + 0.03].map((v) => Number(v.toFixed(2)));
  const bonuses = [baseBonus - 0.1, baseBonus, baseBonus + 0.1].map((v) => Number(Math.max(0.05, v).toFixed(2)));
  const weightedModes = [false, true];
  const spreadWeights = [0, 0.05];
  // ...
}
```

**Đổi thành range rộng hơn:**
```ts
function makeGridCandidates(region: LotteryRegion): GridCandidate[] {
  const baseDecay = DECAY_BY_REGION[region];
  const decays = [baseDecay - 0.08, baseDecay - 0.05, baseDecay - 0.03, baseDecay, baseDecay + 0.03, baseDecay + 0.05]
    .filter((v) => v > 0 && v < 1)
    .map((v) => Number(v.toFixed(2)));
  // Quét rộng tuyệt đối thay vì chỉ quanh baseline, vì baseline overdueBonus có thể đã sai hướng
  const bonuses = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5].map((v) => Number(v.toFixed(2)));
  const weightedModes = [false, true];
  const spreadWeights = [0, 0.05, 0.1, 0.15, 0.2];
  // ... giữ nguyên phần còn lại
}
```

> Lưu ý: range mới khiến số lượng candidate tăng từ `3×3×2×2=36` lên `6×6×2×5=360` mỗi miền — runtime backtest sẽ tăng tương ứng (~10x). Nếu chạy quá lâu (>2-3 phút), cân nhắc giảm bớt `decays`/`spreadWeights` thay vì bỏ hẳn việc mở rộng `bonuses` (ưu tiên quét rộng `overdueBonus` và `spreadWeights` trước, vì đó là 2 thứ có khả năng đổi kết quả Miền Trung nhất).

Sau khi sửa, chạy `npm run lottery-backtest`, đọc lại dòng `best-grid` của cả 3 miền — đặc biệt chú ý xem Miền Trung có tìm ra tham số nào cho `edge` > 1.2% không, và `useWeightedExpectedGap`/`stationSpreadWeight` có được chọn khác `off`/`0` ở miền nào không.

## Phần 2 — Áp dụng tham số mới cho Miền Bắc và Miền Nam

File: [src/lottery/lottery-predict.ts](../src/lottery/lottery-predict.ts)

**Hiện tại:**
```ts
export const DECAY_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0.95,
  "mien-trung": 0.9,
  "mien-nam": 0.93,
};

export const OVERDUE_BONUS_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0.3,
  "mien-trung": 0.3,
  "mien-nam": 0.3,
};
```

**Đổi thành** (theo kết quả grid-search hẹp đã chạy — `decay=0.98 overdueBonus=0.20` cho Bắc, `decay=0.90 overdueBonus=0.20` cho Nam; **Miền Trung giữ nguyên `0.9` / `0.3`**):
```ts
export const DECAY_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0.98,
  "mien-trung": 0.9,
  "mien-nam": 0.9,
};

export const OVERDUE_BONUS_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0.2,
  "mien-trung": 0.3,
  "mien-nam": 0.2,
};
```

> **Quan trọng**: sau khi mở rộng grid-search ở Phần 1 và chạy lại, nếu tìm được tham số tốt hơn nữa cho Bắc/Nam (edge cao hơn `+1.1%`/`+1.8%` hiện tại), dùng tham số mới đó thay vì giữ cứng `0.98/0.2` và `0.9/0.2` ở trên — 2 giá trị này chỉ là kết quả từ grid hẹp ban đầu, chạy lại Phần 1 trước rồi mới chốt Phần 2.

Giá trị `stationSpreadWeight` và `useWeightedExpectedGap` **không cần đổi gì trong `lottery-predict-runner.ts`** vì production hiện gọi `predictTopNumbers(recordsForRegion, region, 3)` không truyền `options` — tự động dùng `DECAY_BY_REGION`/`OVERDUE_BONUS_BY_REGION` mới qua `getScoringOptions()`, còn `useWeightedExpectedGap`/`stationSpreadWeight` mặc định `false`/`0` (tắt) trừ khi grid-search ở Phần 1 cho thấy bật lên có lợi rõ ràng cho 1 miền cụ thể — nếu có, cần sửa thêm `getScoringOptions()` hoặc gọi `predictTopNumbers` kèm `options` cố định cho miền đó (xem lại code trước khi quyết định, không suy đoán).

## Kiểm thử

1. Sau Phần 1: chạy `npm run lottery-backtest`, xác nhận `decay=` không còn `0.00` (bug cũ đã sửa, chỉ cần xác nhận không tái phát), và bộ `best-grid` mới cho cả 3 miền có `edge` ≥ kết quả grid hẹp trước đó (mở rộng range không bao giờ làm `edge` của best giảm, vì baseline vẫn nằm trong range mới)
2. Sau Phần 2: chạy lại `npm run lottery-backtest` lần nữa với `DECAY_BY_REGION`/`OVERDUE_BONUS_BY_REGION` mới làm baseline — xác nhận dòng `baseline` của Bắc/Nam giờ cho `edge` cao hơn baseline cũ (đã áp dụng đúng tham số tốt hơn)
3. `npx tsc --noEmit` — không lỗi type
4. **Không động vào `mien-trung`** trong `DECAY_BY_REGION`/`OVERDUE_BONUS_BY_REGION` — giữ nguyên `0.9`/`0.3` cho tới khi có bằng chứng từ grid mở rộng
5. Theo dõi `lottery_predictions.hit` qua `runLotteryVerify()` trong các kỳ tiếp theo của Miền Bắc/Nam sau khi deploy, để xác nhận cải thiện backtest phản ánh đúng ngoài thực tế (không chỉ là overfit trên dữ liệu lịch sử)
