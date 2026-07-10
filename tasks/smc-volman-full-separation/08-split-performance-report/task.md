# Task 08 — Tách performance-tracking.ts + performance-report-runner.ts theo hệ

Đọc `tasks/smc-volman-full-separation/plan.md` và `tasks/smc-volman-full-separation/context.md` trước.

Phụ thuộc: Subtask 04 (type `PositionDecisionAction` từ `position-engine-volman.js`/`-smc.js`) và Subtask 05 (`loadClosedPositions` từ `positions-repository-volman.js`/`-smc.js`) phải xong trước. Lưu ý: `positions-repository-volman.ts`/`-smc.ts` (task 05) lại import ngược `buildClosedPositionSnapshot`/`ClosedPositionRecord` từ `performance-tracking-volman.js`/`-smc.js` (task này) — đây là phụ thuộc vòng giữa 2 module theo type, không phải phụ thuộc runtime; thực hiện task 05 trước (tạo file với import trỏ sẵn tới `performance-tracking-volman.js`), sau đó task này tạo `performance-tracking-volman.ts` để import đó thoả mãn.

**⚠️ Cập nhật sau self-review:** `src/charts/performance-tracking-volman.ts`/`-smc.ts` **đã tồn tại sẵn** trong working tree. Đọc trước khi làm, chỉ hoàn thiện phần thiếu/sai, không viết lại nếu đã đúng.

## Files được phép sửa/tạo
- Tạo mới: `src/charts/performance-tracking-volman.ts`, `src/charts/performance-tracking-smc.ts`
- Tạo mới: `src/charts/performance-report-runner-volman.ts`, `src/charts/performance-report-runner-smc.ts`
- Tạo mới test tương ứng dưới `tests/charts/`.
- KHÔNG sửa/xoá `performance-tracking.ts`, `performance-report-runner.ts` gốc.
- Cho phép sửa `src/charts/positions-repository-volman.ts` và `src/charts/positions-repository-smc.ts` CHỈ ở dòng import `buildClosedPositionSnapshot`/`ClosedPositionRecord` — đổi từ `./performance-tracking.js` sang `./performance-tracking-volman.js` (file volman) hoặc `./performance-tracking-smc.js` (file smc) tương ứng. Không sửa gì khác trong 2 file đó.

## Bước 1 — `performance-tracking-volman.ts` / `-smc.ts`

Copy toàn bộ `src/charts/performance-tracking.ts` (đã đọc đầy đủ — types `ClosedPositionRecord`, `ClosedPositionSnapshot`, `PerformanceSummary`, `PerformanceReport`; hàm `buildClosedPositionSnapshot`, `summarizeClosedPositionsPerformance` và toàn bộ helper private) vào CẢ HAI file y nguyên 100% logic tính toán (round2, parsePrice, clampPercent, inferCloseReason, calculateInitialRisk, calculateExitRiskRewardFromStop, calculateRemainingRiskReward, calculateTotalRealizedRiskReward).

Chỉ đổi:
- `performance-tracking-volman.ts`: `import type { PositionDecisionAction } from "./position-engine-volman.js";`
- `performance-tracking-smc.ts`: `import type { PositionDecisionAction } from "./position-engine-smc.js";`

## Bước 2 — `performance-report-runner-volman.ts` / `-smc.ts`

Copy toàn bộ `src/charts/performance-report-runner.ts` vào cả 2 file. Đổi:
- Volman: `loadClosedPositions` từ `./positions-repository-volman.js`; `summarizeClosedPositionsPerformance` từ `./performance-tracking-volman.js`; logger name `"charts:performance-report-volman"`.
- SMC: tương tự trỏ `-smc`.
- Giữ nguyên `import { sendMessage, buildPerformanceReportMessage } from "../shared/telegram.js";` tạm thời (task 09 sẽ tách file này; nếu task 09 đổi tên hàm, sẽ tự cập nhật import ở đó — task này KHÔNG cần lo việc đó).
- Giữ nguyên toàn bộ logic `getPeriodConfig()` (đọc `PERFORMANCE_REPORT_PERIOD` env, weekly/monthly).
- Giữ nguyên khối cuối file gọi `runPerformanceReport().catch(...)` (đây là script entrypoint chạy trực tiếp qua `node`, không phải import bởi `index.ts` — kiểm tra trong `package.json`/workflows xem script nào gọi `performance-report-runner.ts` trực tiếp, và ghi chú trong `result.md` rằng ở task 10 cần cập nhật script đó trỏ sang bản `-volman`/`-smc` tương ứng, hoặc tạo 2 script riêng).

## Bước 3 — Test

Copy `tests/charts/performance-tracking.test.ts` (đọc trước) vào 2 file test mới, đổi import path, giữ nguyên toàn bộ test case số học (đây là phần quan trọng nhất — nhiều phép tính R:R, không được đổi kết quả mong đợi).

## Ngoài phạm vi (KHÔNG làm)
- Không sửa `performance-tracking.ts`, `performance-report-runner.ts` gốc.
- Không sửa `shared/telegram.ts` (task 09).
- Không sửa `package.json`/GitHub workflow scripts (chỉ ghi chú, để task 10 xử lý).

## Verification
```bash
npm run build
npm run test
```
Ghi kết quả vào `tasks/smc-volman-full-separation/08-split-performance-report/result.md`.
