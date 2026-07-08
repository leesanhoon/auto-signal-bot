# Review findings — Phase 06: Performance tracking

Review của các thay đổi liên quan tới [docs/tasks/06-performance-tracking.md](06-performance-tracking.md).

## Đã verify OK
- [src/charts/performance-tracking.ts](../../src/charts/performance-tracking.ts): thiết kế equity-curve drawdown hợp lý (cộng dồn R theo thời gian đóng lệnh, track peak, `maxDrawdown = max(peak - equity)`), tính win/loss/breakeven dựa trên `totalRealizedRiskReward` (kết hợp phần đã chốt TP1 + phần còn lại theo tỷ lệ % đã đóng) — logic tổng hợp theo cặp và portfolio đều đúng.
- Migration [supabase/migrations/20260701140500_performance_tracking.sql](../../supabase/migrations/20260701140500_performance_tracking.sql): thêm `close_reason`, `realized_risk_reward_ratio`, `realized_exit_price` đúng nhu cầu.
- `loadClosedPositions()` trong [positions-repository.ts](../../src/charts/positions-repository.ts) query đúng, có filter theo `since`.
- [performance-report-runner.ts](../../src/charts/performance-report-runner.ts): đọc period từ env (`weekly`/`monthly`), tính khoảng lookback đúng (7/30 ngày), gửi Telegram.
- Workflow [.github/workflows/performance-report.yml](../../.github/workflows/performance-report.yml): 2 cron riêng cho weekly/monthly, có `workflow_dispatch` để chạy tay, resolve period đúng theo cron nào trigger.
- `buildPerformanceReportMessage` trong [telegram.ts](../../src/shared/telegram.ts) format rõ ràng, đủ số liệu (win rate, R trung bình, drawdown, theo từng cặp).
- `npm test` (8 files, 25 tests pass), `npx tsc --noEmit` sạch.

## Bug đã fix
### `closePosition()` gán sai `closeReason` cho lệnh đóng thủ công không phải TP2
**Mức độ: nghiêm trọng — làm sai lệch chính số liệu mà Phase 06 sinh ra để đo lường.**

Trong [src/charts/positions-repository.ts:267](../../src/charts/positions-repository.ts), hàm `closePosition()` gọi:
```ts
buildClosedPositionSnapshot(..., decision.decision === "STOP" ? "STOP" : "TP2_CLOSE", ...)
```
Tức là **bất kỳ decision nào không phải `STOP` đều bị coi là `TP2_CLOSE`**. Nhưng theo `deriveManagementPatch` trong [position-engine.ts](../../src/charts/position-engine.ts) (nhánh cuối, dòng ~258): khi model trả về `decision.decision === "CLOSE"` mà **không liên quan gì tới `tp2Reached`** (ví dụ setup bị invalidated, trend đảo chiều, model muốn thoát lệnh sớm dù chưa tới TP1/TP2), `closePosition` vẫn trả về `true` — và khi gọi `closePosition()` ở repository, nhánh này bị quy thành `"TP2_CLOSE"` giống hệt trường hợp thật sự đạt TP2.

**Hậu quả:** `buildClosedPositionSnapshot` với `closeReason = "take_profit_2"` sẽ tính reward bằng `tp2RiskRewardRatio` (con số R:R **kỳ vọng theo kế hoạch ban đầu**, luôn dương), thay vì tính từ giá đóng thực tế. Một lệnh thực chất bị lỗ hoặc breakeven (model thoát sớm vì setup hỏng) sẽ được ghi nhận vào báo cáo hiệu suất như một "thắng đạt TP2" — sai lệch trực tiếp win-rate và R:R trung bình, đúng ngay chỉ số cốt lõi mà tính năng này sinh ra để đo lường.

Constraint SQL `check (close_reason in ('stop_loss', 'take_profit_2') or close_reason is null)` cũng không chừa chỗ cho một lý do đóng "thủ công/invalidated" — lỗi bị cứng hoá luôn ở tầng schema.

**Không có test nào cover nhánh này** — test hiện tại (`tests/charts/performance-tracking.test.ts`) chỉ test rõ ràng 2 case `"STOP"` và `"TP2_CLOSE"`, không có case `decision.decision === "CLOSE"` mà không đạt TP2.

**Cách fix (chọn 1):**
- **Cách A (khuyến nghị):** Phân biệt rõ 3 lý do đóng thay vì 2: thêm giá trị thứ 3 cho `close_reason`, ví dụ `'manual_close'`, dùng khi `decision.decision === "CLOSE"` nhưng `!decision.tp2Reached` và `decision.managementAction !== "TP2_CLOSE"`. Cập nhật:
  - Constraint SQL: `check (close_reason in ('stop_loss', 'take_profit_2', 'manual_close') or close_reason is null)`.
  - `buildClosedPositionSnapshot` cần nhận đúng closeReason được truyền vào (không suy diễn lại từ `decision.decision`), và tính `realizedRiskRewardRatio` cho `manual_close` dựa trên **giá đóng thực tế tại thời điểm đó** (nếu có) thay vì `tp2RiskRewardRatio`. Nếu chưa có giá thực tế available ở thời điểm này, tối thiểu nên dùng `calculateExitRiskRewardFromStop`-style tính từ `currentStopLoss`/giá hiện tại thay vì mặc định coi là thắng TP2.
  - `closePosition()` trong `positions-repository.ts` truyền đúng closeReason (`decision.tp2Reached || decision.managementAction === "TP2_CLOSE" ? "TP2_CLOSE" : decision.decision === "STOP" ? "STOP" : "MANUAL_CLOSE"`).
- **Cách B (tối thiểu, ít thay đổi hơn):** Giữ 2 giá trị hiện có nhưng đổi mặc định: nhánh `CLOSE` chung (không tp2Reached) nên map về `"stop_loss"` (tính theo `calculateExitRiskRewardFromStop`, dùng giá SL/trailing hiện tại) thay vì `"take_profit_2"` — an toàn hơn về mặt thống kê (thiên về đánh giá thấp thay vì thổi phồng thắng), dù vẫn không hoàn toàn chính xác 100%.

- [x] Chọn cách A và implement `manual_close`.
- [x] Thêm test cho case `decision.decision === "CLOSE"` mà `tp2Reached = false` và `managementAction !== "TP2_CLOSE"` — xác nhận `closeReason` và `realizedRiskRewardRatio` phản ánh đúng (không tự động coi là thắng TP2).
- [x] Chạy `npm test` và `npx tsc --noEmit` sau khi sửa.

## Việc cần làm cho codex
- [x] Fix bug closeReason ở mục trên.
- [x] Bổ sung test cho nhánh CLOSE không đạt TP2.
