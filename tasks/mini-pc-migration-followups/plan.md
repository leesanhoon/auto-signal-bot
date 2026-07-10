# Plan — Fix issues phát hiện khi review ảnh hưởng của việc xoá `schedule:` lên lệnh Telegram

**Task ID:** `mini-pc-migration-followups`
**Nguồn:** review thủ công (không phải reviews/ tự động) sau khi mini PC đã chạy ổn và `schedule:` bị xoá khỏi 8 workflow.
**Lead:** đã đọc `supabase/functions/telegram-webhook/index.ts`, `src/charts/chart-config-env.ts`, `src/charts/index.ts`, `src/charts/smc-index.ts`, và toàn bộ `.github/workflows/*.yml` hiện có.

## Bối cảnh

Câu hỏi gốc: xoá `schedule:` khỏi các workflow GitHub Actions (chuyển lịch chạy sang mini PC) có ảnh hưởng gì đến các lệnh/nút bấm Telegram không?

**Kết luận chính: KHÔNG.** Toàn bộ nút bấm trong menu Telegram (📊 Phân tích chart, ⚽ Quét kèo, 🎰 Quét xổ số, 🔮 Dự đoán, ✅ Xác minh, 📈 Báo cáo) đi qua Supabase Edge Function `telegram-webhook`, hàm này gọi GitHub API `POST /actions/workflows/{file}/dispatches` — tức luôn dùng trigger `workflow_dispatch`, không bao giờ dùng `schedule`. Vì tất cả 8 workflow vẫn giữ nguyên `workflow_dispatch:` (chỉ xoá `schedule:`), các nút bấm hoạt động y hệt trước khi migrate. `/help` và `/stats` cũng độc lập hoàn toàn, chỉ đọc thẳng Supabase, không đụng workflow nào.

Tuy nhiên trong lúc review phát hiện **2 vấn đề có thật**, không phải do việc xoá `schedule:` gây ra trực tiếp nhưng liên quan mật thiết tới cùng luồng và nên xử lý cùng đợt:

1. **BUG-1 (có sẵn từ trước, độc lập với migration):** 3 nút submenu "🔮 Dự đoán xổ số ▸" → chọn Miền Bắc/Trung/Nam gọi `dispatchWorkflow` với `workflow.file` = `lottery-predict-mien-nam.yml` / `-trung.yml` / `-bac.yml` (`supabase/functions/telegram-webhook/index.ts:57-68`). **Các file này không tồn tại** trong `.github/workflows/` — chỉ có một `lottery-predict.yml` duy nhất, đã hỗ trợ sẵn `inputs.region` (`all | mien-bac | mien-trung | mien-nam`). Khi user bấm 1 trong 3 nút này, GitHub API trả 404, Telegram hiện lỗi `❌ Không thể kích hoạt`. Nút "Cả 3 miền" (gọi đúng `lottery-predict.yml` không kèm input) vẫn hoạt động bình thường.

2. **BUG-2 (phát sinh từ migration sang mini PC):** `getConfiguredChartRunContext()` (`src/charts/chart-config-env.ts:66-81`) quyết định `"auto"` hay `"manual"` dựa vào `GITHUB_EVENT_NAME` (`schedule` → auto, `workflow_dispatch` → manual), ảnh hưởng logic heartbeat/cache trong `src/charts/index.ts` và `src/charts/smc-index.ts` (dùng cache mới nhất khi manual, gửi heartbeat khác nhau theo context). Trên mini PC, biến `GITHUB_EVENT_NAME` **không tồn tại** (không chạy qua Actions) và `CHART_RUN_CONTEXT` trong `.env`/`.env.example` đang để trống → mặc định rơi về `"manual"`. Nghĩa là các job cron thật sự tự động trên mini PC (`analyze`, `analyze-smc`) đang bị hệ thống hiểu nhầm là chạy tay, dùng sai nhánh cache/heartbeat so với hành vi gốc khi còn chạy `schedule` trên GitHub Actions.

## Kiến trúc quyết định

- **BUG-1:** Sửa trong `supabase/functions/telegram-webhook/index.ts` — đổi `file` của 3 entry `lottery_predict_mien_{nam,trung,bac}` về `"lottery-predict.yml"`, thêm `parseInputs: () => ({ region: "mien-<x>" })` để truyền đúng input có sẵn của workflow chung. Không tạo thêm file `.yml` mới (tránh trùng lặp logic chọn miền).
- **BUG-2:** Sửa trong `deploy/windows/run-job.ps1` — set `CHART_RUN_CONTEXT = "auto"` riêng cho 2 job "analyze" và "analyze-smc" (không đổi global `.env`, để không ảnh hưởng các lần chạy tay/test khác qua `run-job.ps1`). Đây là nơi mini PC tương đương với "đây là lịch cron", giống hệt ý nghĩa `GITHUB_EVENT_NAME=schedule` trước kia.
- Không đụng vào lịch chạy, không đổi tên job/task đã đăng ký trong Task Scheduler (không cần chạy lại `register-tasks.ps1`, chỉ code trong `run-job.ps1` thay đổi, áp dụng từ lần chạy kế tiếp).

## Subtasks

| # | Thư mục | Mô tả | Files chính | Ưu tiên |
|---|---------|-------|-------------|---------|
| 01 | `01-telegram-lottery-predict-region-fix` | Sửa 3 nút dự đoán xổ số theo miền trỏ vào file workflow không tồn tại | `supabase/functions/telegram-webhook/index.ts` | HIGH |
| 02 | `02-chart-run-context-cron` | Set `CHART_RUN_CONTEXT=auto` cho job cron `analyze`/`analyze-smc` trên mini PC | `deploy/windows/run-job.ps1` | MED |

## Thứ tự thực thi

01 và 02 độc lập nhau, có thể làm song song.

## Verification chung

- Subtask 01: `npm run build` (kiểm tra TypeScript của repo không vỡ, dù file thực chạy trên Deno/Supabase riêng), sau đó `npx supabase functions deploy telegram-webhook` (Worker chỉ cần liệt kê lệnh cần chạy trong `result.md`, KHÔNG tự deploy — deploy là hành động ảnh hưởng hệ thống production, cần user xác nhận trước).
- Subtask 02: kiểm tra cú pháp PowerShell bằng `[System.Management.Automation.PSParser]::Tokenize(...)` (đã dùng cách này khi viết `run-job.ps1` lần đầu), rồi chạy thử `.\deploy\windows\run-job.ps1 -Job analyze-smc` (nếu Worker có môi trường Windows) và log ra `runContext` trong log file để xác nhận in ra `auto`.

Worker ghi output vào `result.md` làm evidence. Nếu blocked → `blocked.md`.

## Ngoài scope (không làm trong đợt này)

- Không dọn dead code "chọn tham số theo `github.event.schedule`" còn sót trong `performance-report.yml`, `lottery-verify.yml`, `lottery-predict.yml` (vô hại vì `schedule:` đã bị xoá, chỉ còn nhánh `workflow_dispatch` chạy được).
- Không tự động deploy Supabase Edge Function — chỉ chuẩn bị code, việc deploy do user quyết định thời điểm.
