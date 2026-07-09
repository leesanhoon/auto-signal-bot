# Plan: SMC Signal Noise Reduction

## Bối cảnh / Vấn đề

Hiện tại **mỗi lần SMC scanner chạy đều sinh ra tín hiệu vào lệnh**. Nguyên nhân đã xác định (không phải do thị trường luôn có setup, mà do thiết kế pipeline):

1. **Cửa sổ quét 20 nến báo lại tín hiệu cũ** — `analyzeSmcWindow` (`src/charts/smc/smc-pipeline.ts:374-387`) quét 20 nến gần nhất và trả về candidate có confidence cao nhất trong toàn bộ cửa sổ. Một setup trigger ở nến X sẽ bị phát hiện lại và gửi lại Telegram trong ~20 lần chạy tiếp theo (~5 tiếng với M15). Không có dedup ở tầng gửi tín hiệu (dedup chỉ có ở `saveOpenPosition`).
2. **FVG candidate ngưỡng quá thấp** — `buildSmcCandidatesAtIndex` (`src/charts/smc/smc-pipeline.ts:290-337`) tạo candidate `SMC_FVG_CONTINUATION` confidence 60 cho *bất kỳ* Fair Value Gap nào, kể cả khi **chưa có xác nhận cấu trúc cùng hướng**. FVG trên M15 xuất hiện gần như liên tục → hầu như luôn có ít nhất 1 candidate trong cửa sổ.
3. **Không có filter confidence khi gửi tín hiệu** — `getConfiguredChartSignalConfidenceThreshold()` (default 70) chỉ gate việc auto-track open position trong `smc-index.ts`. Setup confidence thấp (vd. FVG 60 − 10 penalty OFF_HOURS = 50) vẫn vào `result.setups` và gửi Telegram như tín hiệu vào lệnh.

## Mục tiêu

Sau khi hoàn thành: một trigger SMC chỉ được báo **một lần** (tại nến vừa đóng), FVG không xác nhận cấu trúc không còn là tín hiệu vào lệnh, và tín hiệu dưới ngưỡng confidence tối thiểu không được gửi. Kết quả kỳ vọng: phần lớn các lượt chạy sẽ là "no setup" — đó là hành vi đúng.

## Thiết kế

### Fix 1 — Freshness filter cho signal window (subtask 01)

- `analyzeSmcWindow` vẫn quét cửa sổ 20 nến để chọn candidate tốt nhất, nhưng chỉ **trả về signal nếu `triggerIndex` nằm trong N nến cuối** (freshness window).
- N đọc từ env `SMC_SIGNAL_FRESHNESS_CANDLES`, default `1` (chỉ nhận trigger tại nến vừa đóng). Vì cache phân tích đã key theo candle key (mỗi nến đóng chỉ analyze 1 lần), freshness=1 nghĩa là mỗi trigger được báo đúng 1 lần.
- Không đổi hành vi backtest: `analyzeSmcSignalsAtIndex` và `collectSmcCandidatesInRange` giữ nguyên.

### Fix 2 — FVG bắt buộc có xác nhận cấu trúc (subtask 02)

- Trong `buildSmcCandidatesAtIndex`, chỉ push candidate FVG khi `hasConfirmingStructure === true` (structure break cùng hướng FVG). Bỏ nhánh confidence 60 không xác nhận.
- Lưu ý: hàm này dùng chung cho backtest — thay đổi này ảnh hưởng backtest, chấp nhận vì đây là sửa chất lượng tín hiệu gốc.

### Fix 3 — Ngưỡng confidence tối thiểu để gửi tín hiệu (subtask 03)

- Thêm env `SMC_MIN_SIGNAL_CONFIDENCE` (default `65`) qua getter mới trong `chart-config-env.ts`.
- `analyzeAllChartsSmc` nhận option `minSignalConfidence`; pair có signal dưới ngưỡng được xử lý như `no_setup` với reason rõ ràng.
- `smc-index.ts` truyền giá trị từ getter vào pipeline.

## Subtasks

| # | Subtask | Files chính | Phụ thuộc |
|---|---------|-------------|-----------|
| 01 | Freshness filter cho `analyzeSmcWindow` + env config | `src/charts/smc/smc-pipeline.ts`, `src/charts/chart-config-env.ts`, `tests/charts/smc/smc-pipeline.test.ts` | — |
| 02 | FVG candidate bắt buộc xác nhận cấu trúc | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | Sau 01 (cùng file, tránh conflict) |
| 03 | Min confidence filter khi gửi tín hiệu | `src/charts/chart-config-env.ts`, `src/charts/smc/smc-pipeline.ts`, `src/charts/smc-index.ts`, tests tương ứng | Sau 02 (cùng file) |

## Ràng buộc

- Không đụng vào flow Volman, pending orders (đang disabled), hay `saveOpenPosition` dedup.
- Không auto-commit / auto-push.
- TypeScript strict mode, arrow functions theo convention hiện có.
- Backtest (`smc-backtest.ts`, `smc-backtest-runner.ts`) không được đổi hành vi ngoài ảnh hưởng gián tiếp từ Fix 2 (đã chấp nhận trong thiết kế).

## Verification

```bash
npm run build
npm run test
```

Cả hai phải pass sau mỗi subtask. Worker ghi evidence (output tóm tắt) vào `result.md`.
