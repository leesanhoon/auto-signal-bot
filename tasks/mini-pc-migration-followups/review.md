# Review — mini-pc-migration-followups

**Ngày:** 2026-07-10 · **Lead reviewer:** Sonnet 5

## 01-telegram-lottery-predict-region-fix — APPROVED

Đối chiếu `plan.md` + `task.md` với code thực tế tại `supabase/functions/telegram-webhook/index.ts:57-71`:

- 3 entry `lottery_predict_mien_{nam,trung,bac}` đã đổi `file` về `"lottery-predict.yml"`, thêm `parseInputs: () => ({ region: "mien-<x>" })`. Đúng yêu cầu, giữ nguyên key/description/vị trí.
- Truy vết luồng thực thi: `buildLotteryPredictSubmenuKeyboard` → callback `run:lottery_predict_mien_bac` → `parseCallbackData` → `runWorkflowFromCallback` → `workflow.parseInputs([])` → `{ region: "mien-bac" }` → `dispatchWorkflow(..., inputs)`. Khớp đúng `workflow_dispatch.inputs.region` (`choice`: all/mien-bac/mien-trung/mien-nam) mà `.github/workflows/lottery-predict.yml` đã hỗ trợ sẵn.
- Không đụng `lottery-predict.yml`, callback data, UI, hay COMMANDS khác — verified bằng diff, không có thay đổi ngoài phạm vi.
- Type-check thủ công: `parseInputs?: (args: string[]) => Record<string, string>` — hàm mới `() => ({...})` hợp lệ theo quy tắc tham số ít hơn vẫn gán được trong TypeScript.

**Lưu ý (không chặn approval):** `result.md` dẫn "npm run build pass" làm evidence, nhưng `tsconfig.json` chỉ `include: ["src/**/*"]` nên `tsc` không type-check file trong `supabase/functions/`. Evidence không sai nhưng không thực sự xác nhận file đã sửa — Worker nên tránh dẫn bằng chứng không áp dụng cho file đang sửa ở các task sau. Đã tự verify đúng bằng cách đọc code trực tiếp.

Deploy: Worker đúng theo yêu cầu, KHÔNG tự chạy `npx supabase functions deploy telegram-webhook`. Cần user tự deploy khi sẵn sàng.

## 02-chart-run-context-cron — APPROVED

Đối chiếu `plan.md` + `task.md` với code thực tế tại `deploy/windows/run-job.ps1:13-14`:

- Chỉ 2 job `analyze` và `analyze-smc` được thêm `Env = @{ CHART_RUN_CONTEXT = "auto" }`. Không đụng job nào khác.
- Thứ tự nạp env trong file đúng: `.env` load (dòng 41-45) → Chromium path (48-50) → job-specific Env override (53-57, ghi đè sau cùng). Đảm bảo `CHART_RUN_CONTEXT=auto` không bị `.env` (có thể để trống) ghi đè ngược.
- Không đổi `.env`/`.env.example` global, không đổi `chart-config-env.ts`. Đúng scope.
- Cú pháp PowerShell hợp lệ (đã tự parse-check lại bằng `PSParser::Tokenize`), file lưu UTF-8 BOM.
- Runtime test (chạy thật `run-job.ps1 -Job analyze-smc` và xem log `runContext: auto`) bị SKIP vì môi trường không có Playwright/credentials — chấp nhận được, đã ghi rõ cách user tự verify sau khi deploy lên mini PC.

## Kết luận

Cả 2 subtask hoàn thành đúng scope, không deviation, code đúng như thiết kế trong `plan.md`. Không cần fix loop.
