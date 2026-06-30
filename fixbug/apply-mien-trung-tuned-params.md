# Áp dụng tham số grid-search tốt nhất cho Miền Trung

## Context

Sau khi mở rộng grid-search ([fixbug/widen-grid-and-apply-bac-nam.md](widen-grid-and-apply-bac-nam.md) — đã áp dụng phần Bắc/Nam), kết quả backtest mới nhất:

```
mien-trung  baseline   898       12.7%      11.5%      +1.2%
mien-trung  best-grid  898       12.8%      11.5%      +1.3%
  decay=0.90 overdueBonus=0.00 weightedGap=off spread=0.15
```

Miền Trung có cải thiện thật (`edge` +1.2% → +1.3%) với công thức khác hẳn baseline hiện tại:
- `overdueBonus = 0.00` (hiện đang `0.3`) — tín hiệu "quá hạn" không giúp ích gì cho Miền Trung, nên tắt hẳn
- `stationSpreadWeight = 0.15` (hiện đang `0`, vì `getScoringOptions()` mặc định `stationSpreadWeight: 0` cho mọi miền khi không truyền `options`) — tín hiệu "lan toả nhiều đài" có ích cho Miền Trung

`decay = 0.90` đã đúng baseline hiện tại, không cần đổi.

## Vấn đề: `stationSpreadWeight` hiện không có cấu hình theo miền

File [src/lottery/lottery-predict.ts](../src/lottery/lottery-predict.ts), hàm `getScoringOptions()`:
```ts
function getScoringOptions(region: LotteryRegion, options?: PredictionScoringOptions): Required<PredictionScoringOptions> {
  return {
    decay: options?.decay ?? DECAY_BY_REGION[region],
    overdueBonus: options?.overdueBonus ?? OVERDUE_BONUS_BY_REGION[region],
    useWeightedExpectedGap: options?.useWeightedExpectedGap ?? false,
    stationSpreadWeight: options?.stationSpreadWeight ?? 0,
  };
}
```
`decay` và `overdueBonus` đã có map riêng theo miền (`DECAY_BY_REGION`, `OVERDUE_BONUS_BY_REGION`), nhưng `stationSpreadWeight` đang hardcode `0` cho mọi miền khi `lottery-predict-runner.ts` gọi `predictTopNumbers()` không kèm `options` (đúng là cách production đang gọi — xem `lottery-predict-runner.ts:77`: `predictTopNumbers(recordsForRegion, region, 3)`).

## Thay đổi cần làm

### 1. Thêm `STATION_SPREAD_WEIGHT_BY_REGION` trong `lottery-predict.ts`

Theo đúng pattern của `OVERDUE_BONUS_BY_REGION`:

```ts
/** Hệ số cộng điểm cho số xuất hiện trên nhiều đài trong cùng kỳ (chỉ có ý nghĩa với miền nhiều đài/kỳ). */
export const STATION_SPREAD_WEIGHT_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0,
  "mien-trung": 0.15,
  "mien-nam": 0,
};
```

Và sửa `OVERDUE_BONUS_BY_REGION["mien-trung"]` từ `0.3` xuống `0`:
```ts
export const OVERDUE_BONUS_BY_REGION: Record<LotteryRegion, number> = {
  "mien-bac": 0.2,
  "mien-trung": 0,
  "mien-nam": 0.2,
};
```

### 2. Sửa `getScoringOptions()` dùng map mới thay vì hardcode `0`

```ts
function getScoringOptions(region: LotteryRegion, options?: PredictionScoringOptions): Required<PredictionScoringOptions> {
  return {
    decay: options?.decay ?? DECAY_BY_REGION[region],
    overdueBonus: options?.overdueBonus ?? OVERDUE_BONUS_BY_REGION[region],
    useWeightedExpectedGap: options?.useWeightedExpectedGap ?? false,
    stationSpreadWeight: options?.stationSpreadWeight ?? STATION_SPREAD_WEIGHT_BY_REGION[region],
  };
}
```

Vì Bắc/Nam đều để `0` trong map mới, hành vi của 2 miền này **không đổi** — chỉ Miền Trung có `stationSpreadWeight=0.15` khi không truyền `options` (đúng đường production thật dùng).

### 3. Không cần sửa `lottery-backtest-index.ts`

`makeGridCandidates()` đã tự tạo candidate quét rộng `stationSpreadWeight` độc lập với map mới này — không xung đột, không cần sửa gì thêm ở đó. Map `STATION_SPREAD_WEIGHT_BY_REGION` mới chỉ ảnh hưởng baseline production (khi gọi không kèm `options`) và dòng `baseline` trong output backtest.

## Kiểm thử

1. `npx tsc --noEmit` — không lỗi type
2. Chạy `npm run lottery-backtest` — dòng `baseline` của Miền Trung giờ phải khớp đúng `edge` mà trước đó `best-grid` báo cáo (~+1.3%), vì baseline giờ chính là tham số đã tối ưu. Dòng `best-grid` của Miền Trung có thể trùng `baseline` hoặc tìm ra cải thiện nhỏ hơn nữa (không bắt buộc bằng nhau tuyệt đối vì baseline/grid build candidate hơi khác cách làm tròn số)
3. Xác nhận Bắc/Nam **không đổi gì** (vì `STATION_SPREAD_WEIGHT_BY_REGION` của 2 miền này = `0`, giống hệt giá trị mặc định cũ)
4. Sau khi deploy, theo dõi `lottery_predictions.hit` của Miền Trung qua `runLotteryVerify()` trong các kỳ tiếp theo để xác nhận cải thiện ngoài thực tế (không chỉ overfit lịch sử)
