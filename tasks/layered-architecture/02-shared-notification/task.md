# Task 02: Shared Notification Layer

**Đọc trước:** [`../plan.md`](../plan.md) và [`../context.md`](../context.md) — bắt buộc. **Phụ thuộc subtask 01 đã hoàn thành và approved.**

## Mục tiêu

Tách phần **raw Telegram Bot API client** ra khỏi `src/shared/telegram.ts` (hiện đang trộn với các hàm build-message domain-specific của chart), đưa vào `src/shared/notification/`, và làm cho `Notifier` interface (hiện là dead code) **thực sự được dùng**. Các hàm build-message domain-specific (`buildSmcSignalMessage`, `buildPositionDecisionMessage`, `buildPerformanceReportMessage`, `buildHeartbeatMessage`, `sendAllAnalyses`, `findScreenshotForSetup`, ...) **giữ nguyên tại `src/shared/telegram.ts`** ở subtask này — việc di dời chúng sang `src/charts/service/` sẽ làm ở subtask 05 (charts), không làm ở đây.

## Việc cần làm

1. Đọc toàn bộ `src/shared/telegram.ts` và `src/shared/notifier.ts` để liệt kê chính xác các hàm raw API (gọi trực tiếp Telegram Bot HTTP endpoint, không phụ thuộc type domain) so với hàm build-message (phụ thuộc `TradeSetup`, `AnalysisResult`, v.v.).
   - Hàm raw API dự kiến (xác nhận lại bằng cách đọc file thật): `sendMessage`, `sendPhoto`, `sendDocument`, `setMyCommands`, `setChatMenuButton`, `notifyError`.
2. Tạo `src/shared/notification/telegram-client.ts`:
   - Di chuyển các hàm raw API (bước 1) vào đây nguyên trạng logic.
   - Export thêm factory theo mẫu DI trong `context.md`:
     ```ts
     export interface TelegramClient {
       sendMessage(text: string): Promise<void>;
       sendPhoto(photoBuffer: Buffer, caption: string): Promise<void>;
       sendDocument(buffer: Buffer, filename: string, caption?: string): Promise<void>;
       // ... các method khác nếu có, khớp signature thật của hàm raw API hiện tại
     }

     export function createTelegramClient(): TelegramClient {
       return { sendMessage, sendPhoto, sendDocument /* ... */ };
     }
     ```
     (Khớp đúng signature thật — đọc file gốc trước khi viết interface, không đoán tham số.)
3. Cập nhật `src/shared/notifier.ts`:
   - Giữ `Notifier` interface, đảm bảo nó khớp với các method thật sự cần dùng (tối thiểu `sendMessage`, `sendPhoto`; thêm `sendDocument` nếu domain lottery cần — kiểm tra `lottery-runner.ts` dùng `sendDocument`).
   - Export `createTelegramNotifier(): Notifier` — có thể implement bằng cách gọi `createTelegramClient()` từ bước 2 (composition đơn giản, không phải class kế thừa).
4. `src/shared/telegram.ts`: xoá các hàm đã di chuyển ở bước 2, thay bằng re-export để import cũ không vỡ:
   ```ts
   export { sendMessage, sendPhoto, sendDocument, setMyCommands, setChatMenuButton, notifyError } from "./notification/telegram-client.js";
   ```
   Các hàm build-message domain-specific (`buildSmcSignalMessage`, v.v.) **giữ nguyên tại chỗ, không di chuyển, không đổi nội dung.**
5. Grep toàn repo (`src/`, `tests/`) tìm mọi import từ `shared/telegram.js` hoặc `shared/notifier.js`, xác nhận không vỡ sau thay đổi.

## Việc KHÔNG được làm

- Không sửa logic/format của bất kỳ hàm build-message nào (`buildSmcSignalMessage`, `buildHeartbeatMessage`, `buildPositionDecisionMessage`, `buildPerformanceReportMessage`, `sendAllAnalyses`, `findScreenshotForSetup`).
- Không sửa file trong `src/charts/`, `src/betting/`, `src/lottery/` — chúng vẫn import từ `shared/telegram.js` như cũ và phải tiếp tục hoạt động.
- Không đổi format message gửi Telegram (nội dung text/caption phải y hệt).
- Không thêm retry/error-handling mới ngoài những gì đã có trong code gốc.

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, số test không giảm so với baseline ghi trong `result.md` của subtask 01 (chạy lại `npm test` để lấy baseline mới nếu cần).
- `src/shared/notification/telegram-client.ts` tồn tại, export `TelegramClient` interface + `createTelegramClient()`.
- `src/shared/notifier.ts` export `Notifier` interface (đã có sẵn, xác nhận khớp) + `createTelegramNotifier()`.
- `src/shared/telegram.ts` vẫn tồn tại, chứa hàm build-message domain-specific nguyên trạng + re-export raw API.
- Grep xác nhận không import path nào bị vỡ.

## Kết quả cần ghi vào `result.md`

- Danh sách hàm đã xác định là "raw API" vs "build-message", kèm dòng code trích dẫn xác nhận phân loại đúng.
- Danh sách file đã tạo/sửa.
- Output `npm run build` và `npm test`.
- Nếu phát hiện `Notifier` interface hiện tại thiếu method mà code thật cần (vd `sendDocument` dùng ở lottery) → bổ sung vào interface và ghi rõ lý do trong `result.md`, không tự ý bỏ qua.
