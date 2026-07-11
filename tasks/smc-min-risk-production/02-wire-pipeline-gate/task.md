# Task 02: Wire min-risk gate vào production pipeline

## Phụ thuộc

Subtask 01 phải xong trước: hàm `getConfiguredSmcMinRiskPct()` đã tồn tại trong `src/charts/smc-config-env.ts`.

## Bối cảnh

Production entrypoint SMC là `analyzeAllChartsSmc` trong `src/charts/smc/smc-pipeline.ts`. Nó đã có một gate mẫu — gate confidence — hoạt động như sau:

- `src/charts/smc-index.ts` dòng ~75-76: đọc config bằng `getConfiguredSmcMinSignalConfidence()` rồi truyền vào options: `analyzeAllChartsSmc(getPairs(), { timeframeMode, primaryTimeframe, minSignalConfidence })`.
- `smc-pipeline.ts` dòng ~471: sau khi chọn `signals[0]`, nếu `confidence < nguong` thì return `{ kind: "no_setup", reason: "Setup SMC bi loai do confidence ... < nguong ..." }`.

Min-risk gate làm **giống hệt pattern đó**, thêm một tầng sau gate confidence.

## Việc cần làm

### 1. `src/charts/smc/smc-pipeline.ts`

a. Thêm `minRiskPct?: number;` vào type options của `analyzeAllChartsSmc` (cạnh `minSignalConfidence?: number;`, dòng ~441).

b. Đọc option: `const minRiskPct = options.minRiskPct ?? 0;` (cạnh dòng `const minSignalConfidence = ...`, ~445).

c. Thêm gate NGAY SAU khối gate confidence (sau khối `if (minSignalConfidence > 0 && ...)`, trước dòng gọi `checkMultiTimeframeConfluence`):

```ts
if (minRiskPct > 0 && signals[0].entry !== 0) {
  const riskPct = (Math.abs(signals[0].entry - signals[0].stopLoss) / Math.abs(signals[0].entry)) * 100;
  if (riskPct < minRiskPct) {
    return {
      kind: "no_setup" as const,
      pair,
      reason: `Setup SMC bi loai do risk ${riskPct.toFixed(2)}% < nguong ${minRiskPct}% (stop qua hep, phi an het edge)`,
      summaries: [buildSmcPairSummary(pair, gradeToTrend(signals[0].direction), 0, false)],
    };
  }
}
```

QUAN TRỌNG — vị trí đặt gate: ở tầng `analyzeAllChartsSmc` (production), KHÔNG đặt trong `buildSmcCandidatesAtIndex` hay `analyzeSmcSignalsAtIndex` — backtest dùng chung các hàm đó và đã có filter riêng (`BACKTEST_MIN_RISK_PCT` trong `smc-backtest.ts`), đặt sai chỗ sẽ filter 2 lần và làm sai lệch thí nghiệm backtest.

### 2. `src/charts/smc-index.ts`

- Import thêm `getConfiguredSmcMinRiskPct` từ `./smc-config-env.js`.
- Dòng ~75-76: đọc `const minRiskPct = getConfiguredSmcMinRiskPct();` và truyền thêm vào options: `{ timeframeMode, primaryTimeframe, minSignalConfidence, minRiskPct }`.

### 3. Test — `tests/charts/smc/smc-pipeline.test.ts`

File này đã mock sẵn `fetchOhlcHistory`, các detector, và có test cho gate confidence (grep `minSignalConfidence` trong file để xem pattern). Thêm 2 test cho `analyzeAllChartsSmc`:

1. **Bị loại**: mock detector trả setup có entry/stopLoss sao cho risk% < ngưỡng (ví dụ entry 101, stopLoss 100.8 → risk ≈ 0.198%), gọi `analyzeAllChartsSmc` với `minRiskPct: 0.5` → kết quả pair đó là no_setup, `noSetupReasons` chứa chuỗi `"bi loai do risk"`.
2. **Không bị loại**: cùng mock nhưng stopLoss xa hơn (ví dụ entry 101, stopLoss 96 → risk ≈ 4.95%) với `minRiskPct: 0.5` → setup được trả về bình thường (kind ok, có setups).

Lưu ý: mock `findRecentOrderBlock` quyết định entry (midpoint) và stopLoss (ob.low − buffer) — xem các test hiện có quanh dòng 295-360 để lấy fixture mẫu; chỉnh `low`/`high`/`midpoint` của order block để đạt risk% mong muốn. Nếu khó căn chính xác buffer ATR, chọn khoảng cách đủ lớn/nhỏ để chắc chắn nằm 2 phía ngưỡng 0.5%.

Nếu `tests/charts/smc-index.test.ts` có assert danh sách options truyền vào `analyzeAllChartsSmc` (grep `minSignalConfidence` trong file đó), cập nhật expectation thêm `minRiskPct`.

## Ràng buộc

- KHÔNG sửa `smc-backtest.ts`, `buildSmcCandidatesAtIndex`, `analyzeSmcSignalsAtIndex`, `analyzeSmcWindow`.
- KHÔNG đổi logic gate confidence hiện có.
- KHÔNG commit.

## Verification

```bash
npm run build
npm run test
```

Cả hai phải pass (hiện tại 757+ tests).

## result.md

Ghi vào `tasks/smc-min-risk-production/02-wire-pipeline-gate/result.md`:
- Các dòng đã sửa ở 2 file src (kèm line reference).
- Tên 2 test mới + kết quả chạy.
- Output build/test (dòng tổng kết).

## Nếu bị chặn

Ghi `blocked.md` cùng thư mục. Không đoán, không deviation.
