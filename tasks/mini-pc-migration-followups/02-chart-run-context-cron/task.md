# Task 02 — Set `CHART_RUN_CONTEXT=auto` cho job cron `analyze`/`analyze-smc` trên mini PC

**Vấn đề:** `getConfiguredChartRunContext()` (`src/charts/chart-config-env.ts:66-81`) trả về `"auto"` hoặc `"manual"`, quyết định nhánh heartbeat/cache trong `src/charts/index.ts` (dòng ~147, ~265 trở đi) và `src/charts/smc-index.ts` (tương tự). Logic đọc theo thứ tự:

1. `CHART_RUN_CONTEXT` env override nếu có (`"manual"` hoặc `"auto"`).
2. Nếu không, đọc `GITHUB_EVENT_NAME`: `"schedule"` → `auto`, `"workflow_dispatch"` → `manual`.
3. Mặc định: `manual`.

Trước khi migrate, 2 job này chạy qua GitHub Actions `schedule:` nên `GITHUB_EVENT_NAME=schedule` → context luôn là `"auto"`. Sau khi chuyển lịch cron sang mini PC (Task Scheduler gọi `deploy/windows/run-job.ps1`), biến `GITHUB_EVENT_NAME` không tồn tại (không chạy qua Actions), và `CHART_RUN_CONTEXT` trong `.env` đang để trống (`.env.example` dòng có `CHART_RUN_CONTEXT=`) → rơi về mặc định `"manual"`. Kết quả: job cron tự động trên mini PC hiện đang bị hệ thống hiểu nhầm là "chạy tay", dùng sai nhánh cache/heartbeat so với hành vi gốc.

**Mục tiêu:** khi Task Scheduler chạy job `analyze` hoặc `analyze-smc` theo lịch cron, `CHART_RUN_CONTEXT` phải là `"auto"`, y hệt hành vi cũ trên GitHub Actions.

**KHÔNG làm:** không đổi global `.env`/`.env.example` (sẽ ảnh hưởng cả các lần chạy tay/test khác qua `run-job.ps1 -Job analyze` khi debug), không đổi `chart-config-env.ts`, không đụng job nào khác ngoài `analyze` và `analyze-smc`, không cần chạy lại `register-tasks.ps1` (task đã đăng ký chỉ gọi `run-job.ps1`, thay đổi bên trong file này áp dụng ngay từ lần chạy kế tiếp).

## Bước 1 — Sửa `deploy/windows/run-job.ps1`

Trong bảng `$jobs` (đầu file), 2 entry hiện tại:

```powershell
    "analyze"                     = @{ Script = "analyze" }
    "analyze-smc"                 = @{ Script = "analyze:smc" }
```

Đổi thành:

```powershell
    "analyze"                     = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto" } }
    "analyze-smc"                 = @{ Script = "analyze:smc"; Env = @{ CHART_RUN_CONTEXT = "auto" } }
```

Script đã có sẵn cơ chế set `$def.Env` đè lên `.env` (xem đoạn `if ($def.Env) { ... [Environment]::SetEnvironmentVariable ... }` gần cuối `run-job.ps1`), nên không cần sửa gì thêm ở phần logic chạy.

## Bước 2 — Validate cú pháp

```powershell
$errors = $null
[System.Management.Automation.PSParser]::Tokenize([System.IO.File]::ReadAllText((Resolve-Path "deploy\windows\run-job.ps1").Path), [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { $errors } else { "OK" }
```

Lưu file dưới dạng UTF-8 **có BOM** nếu công cụ ghi file không tự làm điều này (bắt buộc để PowerShell 5.1 đọc đúng tiếng Việt trong comment) — dùng lại cách đã áp dụng khi viết các script khác trong `deploy/windows/`:

```powershell
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$p = (Resolve-Path "deploy\windows\run-job.ps1").Path
$text = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($p, $text, $utf8Bom)
```

## Bước 3 — Kiểm thử (nếu có môi trường Windows)

```powershell
.\deploy\windows\run-job.ps1 -Job analyze-smc
Get-Content .\logs\analyze-smc-*.log -Tail 30
```

Trong log của `npm run analyze:smc`, dòng `"Chart scanner starting"` (do `logger.info` in ra) phải có `runContext: "auto"`. Nếu không có môi trường Windows để chạy thật, ghi rõ trong `result.md` là chỉ validate được cú pháp, và mô tả cách user tự kiểm tra log sau khi deploy.

Ghi kết quả vào `tasks/mini-pc-migration-followups/02-chart-run-context-cron/result.md`. Nếu blocked → `blocked.md`.
