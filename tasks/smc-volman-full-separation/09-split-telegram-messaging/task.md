# Task 09 — Tách shared/telegram.ts thành client thô + format nghiệp vụ theo hệ

Đọc `tasks/smc-volman-full-separation/plan.md` và `tasks/smc-volman-full-separation/context.md` trước.

Phụ thuộc thật (đã sửa sau self-review, verify bằng cách đọc import thật của bản đã tồn tại): Subtask 02 (`chart-types-volman.ts`/`-smc.ts`), Subtask 03 (`getConfiguredChartSignalConfidenceThreshold` từ `volman-config-env.js`/`smc-config-env.js`), Subtask 08 (`PerformanceReport` type từ `performance-tracking-volman.js`/`-smc.js`, dùng trong `buildPerformanceReportMessage`). KHÔNG phụ thuộc `position-engine.ts` hay check-runners — `telegram.ts` gốc không import 2 module đó. Đọc toàn bộ `src/shared/telegram.ts` trước khi làm (file dài, đọc hết, không suy đoán).

**⚠️ Cập nhật sau self-review:** `src/shared/telegram-client.ts`, `telegram-volman.ts`, `telegram-smc.ts` **đã tồn tại sẵn** trong working tree (đã verify import thật khớp với dependency đã sửa ở trên). Đọc trước khi làm — nếu đã đúng theo spec dưới đây (đối chiếu kỹ từng hàm), chỉ cần ghi `result.md` xác nhận, không viết lại từ đầu.

## Files được phép sửa/tạo
- Tạo mới: `src/shared/telegram-client.ts`
- Tạo mới: `src/shared/telegram-volman.ts`
- Tạo mới: `src/shared/telegram-smc.ts`
- Tạo mới test tương ứng dưới `tests/shared/`.
- KHÔNG sửa/xoá `src/shared/telegram.ts` gốc.
- KHÔNG sửa các runner đã tạo ở task 07/08 (chúng tiếp tục import `../shared/telegram.js` gốc cho tới task 10 — việc rewire import sang bản mới là việc của task 10, KHÔNG phải task này).

## Bước 1 — Phân loại hàm trong `telegram.ts` gốc

Đọc toàn bộ file, liệt kê rõ trong `result.md` bảng phân loại mỗi export thành 1 trong 3 nhóm:
- **client (hạ tầng thô, không branch theo hệ):** ví dụ `sendMessage`, `sendPhoto`, `sendDocument`, `telegramNotifier`, và các hàm helper gọi Telegram Bot API HTTP thô không chứa nhánh `detectionSource`/`systemLabel`.
- **volman (business logic riêng Bob Volman):** các hàm build message không phải SMC và không dùng chung.
- **smc (business logic riêng SMC):** `buildSmcSignalMessage`, và các hàm chỉ phục vụ setup SMC.
- **dùng chung nhưng có branch theo hệ (`buildHeartbeatMessage`, `buildPositionDecisionMessage`, `buildPerformanceReportMessage`, `sendAllAnalyses`):** những hàm này phải được TÁCH THÀNH 2 BẢN, mỗi bản bỏ nhánh if/else chọn theo hệ, chỉ giữ lại đúng 1 nhánh cố định (branch còn lại xoá vì không còn cần thiết — file volman luôn là volman, file smc luôn là smc).

## Bước 2 — `src/shared/telegram-client.ts`

Copy các hàm/hằng số thuộc nhóm "client" — bao gồm cấu hình gọi Telegram Bot API (đọc `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` từ env, hàm build URL API, `fetch` gọi API, xử lý lỗi mạng, `notifyError` NẾU nó không chứa business logic riêng hệ — nếu `notifyError` có nhận `scope: string` làm tham số chung chung không branch theo hệ, giữ nó ở đây), `Notifier` type re-export nếu cần, `telegramNotifier`.

## Bước 3 — `src/shared/telegram-volman.ts`

Copy toàn bộ hàm build-message dành cho Volman (KHÔNG bao gồm `buildSmcSignalMessage`), cộng với bản đã bỏ nhánh SMC của `buildHeartbeatMessage`, `buildPositionDecisionMessage`, `buildPerformanceReportMessage`, và `sendAllAnalyses` (đổi tên thành `sendAllAnalysesVolman` để tránh nhầm — luôn dùng label `"Bob Volman Multi-Timeframe Scanner"`, không cần tham số `systemLabel` nữa vì cố định). Import type từ `../charts/chart-types-volman.js` thay vì `../charts/chart-types.js`. Import `getConfiguredChartSignalConfidenceThreshold` từ `../charts/volman-config-env.js`. Import `sendMessage`, `sendPhoto`, `sendDocument`, `telegramNotifier` từ `./telegram-client.js`.

## Bước 4 — `src/shared/telegram-smc.ts`

Tương tự bước 3 nhưng chỉ giữ `buildSmcSignalMessage` + bản SMC-only của các hàm build message dùng chung (đổi tên `sendAllAnalyses` thành `sendAllAnalysesSmc`, cố định label `"SMC Multi-Timeframe Scanner"`). Import từ `../charts/chart-types-smc.js`, `../charts/smc-config-env.js`.

## Bước 5 — Test

Đọc `tests/shared/telegram.test.ts` hiện có (nếu tồn tại), phân loại test case theo 3 nhóm tương tự bước 1, viết lại thành 3 file test mới (`tests/shared/telegram-client.test.ts`, `tests/shared/telegram-volman.test.ts`, `tests/shared/telegram-smc.test.ts`), giữ nguyên nội dung assert của từng test case (chỉ đổi import path và bỏ test case liên quan nhánh không còn tồn tại ở từng bản).

## Ngoài phạm vi (KHÔNG làm)
- Không sửa `telegram.ts` gốc.
- Không sửa runner đã tách ở task 07/08 để trỏ sang các file mới này (task 10 làm).
- Không đổi format nội dung tin nhắn Telegram thực tế (copy y nguyên chuỗi/markdown hiện có, chỉ xoá nhánh không dùng).

## Verification
```bash
npm run build
npm run test
```
Ghi kết quả vào `tasks/smc-volman-full-separation/09-split-telegram-messaging/result.md`, kèm bảng phân loại hàm ở Bước 1.
