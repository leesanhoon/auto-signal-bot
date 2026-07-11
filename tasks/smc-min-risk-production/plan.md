# Plan — Đưa Min-Risk Filter vào Production SMC Pipeline

## Bối cảnh

Backtest matrix + multi-window validation (xem `tasks/smc-m15-cost-grade-experiments/results.md`) kết luận:

- SMC M15 có edge dương (+0.39 → +0.56R trên 5/5 cửa sổ) **chỉ khi** loại tín hiệu có stop quá hẹp: khoảng cách entry→SL < 0.5% giá khiến phí quy ra R ăn hết lãi.
- Filter này hiện chỉ tồn tại trong backtest (`BACKTEST_MIN_RISK_PCT`, file `src/charts/smc/smc-backtest.ts`). Production (`analyzeAllChartsSmc` trong `src/charts/smc/smc-pipeline.ts`) chưa có — bot ngoài đời vẫn sẽ gửi các tín hiệu stop hẹp.

## Mục tiêu

Thêm gate min-risk vào production pipeline, cấu hình qua env `SMC_MIN_RISK_PCT` (mặc định 0.5, đặt 0 để tắt), theo đúng pattern của gate `SMC_MIN_SIGNAL_CONFIDENCE` hiện có.

## Không thuộc scope

- KHÔNG đổi logic backtest (`BACKTEST_MIN_RISK_PCT` giữ nguyên, độc lập).
- KHÔNG đổi scoring/grade (đã xong ở task trước).
- KHÔNG thêm killzone-only hay setup mới.
- KHÔNG commit (user quyết định commit).

## Subtasks

| # | Subtask | Files | Phụ thuộc | Done khi |
|---|---|---|---|---|
| 01 | [Env config `SMC_MIN_RISK_PCT`](01-config-env/task.md) | `src/charts/smc-config-env.ts`, test tương ứng | — | Hàm `getConfiguredSmcMinRiskPct()` tồn tại, default 0.5, validate range, có unit test, build+test pass |
| 02 | [Wire gate vào `analyzeAllChartsSmc`](02-wire-pipeline-gate/task.md) | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 01 | Tín hiệu risk% < ngưỡng bị loại thành `no_setup` kèm reason, có test cả 2 nhánh (bị loại / không bị loại), build+test pass |

## Review criteria (Lead sẽ check)

1. Gate đặt SAU khi chọn `signals[0]` và trước khi build setup — cùng vị trí tầng với gate confidence, không lồng vào `buildSmcCandidatesAtIndex` (backtest dùng chung hàm đó và đã có filter riêng).
2. `reason` string ghi rõ risk% thực tế và ngưỡng (phục vụ debug qua noSetupReasons).
3. Default 0.5 khớp giá trị đã validate; env không hợp lệ → fallback 0.5.
4. Không có thay đổi nào ngoài 2 file src + test.

## Checklist vận hành sau khi hoàn thành (user, không phải Worker)

- [ ] Xác nhận venue thực tế maker fee ≤ 0.02% (điều kiện tiên quyết của edge).
- [ ] Commit toàn bộ thay đổi đang treo (scoring, filter backtest, filter production).
- [ ] Paper trade / tiền nhỏ 1–2 tháng, so kết quả live với backtest.
