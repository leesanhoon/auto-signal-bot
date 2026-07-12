# Task 05 — Thêm 3 job Volman M15/H1/H4 vào hạ tầng Task Scheduler có sẵn

## Bối cảnh

Phụ thuộc: Task 01-04 đã xong và verify OK.

Dự án ĐÃ CÓ hạ tầng Windows Task Scheduler hoàn chỉnh tại `deploy/windows/`:
- [`run-job.ps1`](../../../deploy/windows/run-job.ps1) — wrapper: nạp `.env`, set env riêng theo
  job, chạy `npm run <script>`, ghi log vào `logs/<job>-<ngày>.log`. Bảng job định nghĩa trong
  hashtable `$jobs` (dòng ~12-27).
- [`register-tasks.ps1`](../../../deploy/windows/register-tasks.ps1) — đăng ký từng job vào
  Windows Task Scheduler với trigger (giờ VN, máy đã set UTC+7). Job hiện có liên quan Volman:
  `"analyze"` (dòng 58-65, chạy 6 lần/ngày ~mỗi 4h — đây CHÍNH LÀ nhịp H4, không cần đổi lịch).
- KHÔNG dùng file `.bat` — toàn bộ job đều chạy qua `run-job.ps1` (PowerShell), giữ đúng convention
  này, KHÔNG tạo file `.bat` mới.

Quyết định đã chốt với user: giữ nguyên One-way mode Binance, không có thay đổi kiến trúc lớn.
3 job M15/H1/H4 là 3 hệ thống độc lập, mỗi job chỉ quản lý vị thế do chính nó tạo (dựa vào cột
`primary_timeframe` từ Task 01-02).

## Việc cần làm

### 1. Sửa `run-job.ps1` — thêm 2 job mới, đổi tên job `"analyze"` hiện có cho rõ nghĩa

Trong hashtable `$jobs` (khoảng dòng 12-27):

- Đổi entry `"analyze"` hiện có (`@{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto" } }`)
  thành `"analyze-volman-h4"`, thêm `CHART_PRIMARY_TIMEFRAME = "H4"` vào `Env`:
  ```powershell
  "analyze-volman-h4" = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto"; CHART_PRIMARY_TIMEFRAME = "H4" } }
  ```
  (Trước đây job này ngầm định dùng `CHART_PRIMARY_TIMEFRAME=H4` từ `.env` — giờ set tường minh
  trong job để không phụ thuộc giá trị mặc định trong `.env`, tránh vỡ khi `.env` đổi default sau
  này.)

- Thêm 2 entry mới:
  ```powershell
  "analyze-volman-m15" = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto"; CHART_PRIMARY_TIMEFRAME = "M15" } }
  "analyze-volman-h1"  = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto"; CHART_PRIMARY_TIMEFRAME = "H1" } }
  ```

- KHÔNG động vào entry `"analyze-smc"` (đó là hệ SMC, không phải Volman, không thuộc scope task
  này).

### 2. Sửa `register-tasks.ps1` — cập nhật tên job + thêm trigger cho M15/H1

Trong block `# === Charts ===` (khoảng dòng 54-70):

- Đổi `Register-BotTask "analyze" @(...)` thành `Register-BotTask "analyze-volman-h4" @(...)`
  (giữ nguyên 6 trigger giờ VN hiện có — đây đã đúng nhịp ~4h, không cần đổi giờ).

- Thêm ngay sau đó:
  ```powershell
  # analyze-volman-m15 — mỗi 15 phút, cả tuần (giống nhịp analyze-smc)
  Register-BotTask "analyze-volman-m15" @(
      (Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 15 (New-TimeSpan -Days 1))
  )

  # analyze-volman-h1 — mỗi giờ, cả tuần
  Register-BotTask "analyze-volman-h1" @(
      (Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 60 (New-TimeSpan -Days 1))
  )
  ```
  (Copy đúng pattern `Add-Repetition` đã dùng cho `"analyze-smc"` ở dòng 68-70 — không tự nghĩ
  cú pháp khác.)

- Cập nhật dòng gợi ý "Chạy thử ngay" ở cuối file (`Write-Host "Chạy thử ngay: ..."`) nếu có nhắc
  tên job `"analyze"` cũ — sửa cho khớp tên mới.

### 3. `unregister-tasks.ps1` — KHÔNG cần sửa

File này xoá toàn bộ task theo `$taskPath` chung (`\AutoSignalBot\`), không liệt kê tên job tường
minh — không cần cập nhật.

### 4. Cập nhật `deploy/windows/README.md`

- Bảng "Lịch chạy" (dòng ~79-91): sửa dòng `analyze` thành `analyze-volman-h4` (giữ nguyên lịch),
  thêm 2 dòng mới cho `analyze-volman-m15` (mỗi 15 phút, cả tuần) và `analyze-volman-h1` (mỗi giờ,
  cả tuần).
- Thêm 1 đoạn giải thích ngắn: 3 job Volman (M15/H1/H4) chạy độc lập, không liên quan nhau — nếu
  2 job cùng lúc phát hiện tín hiệu trên cùng 1 symbol, job nào tới trước sẽ giữ vị thế thật trên
  Binance (One-way mode chỉ cho 1 vị thế/symbol); job đến sau bị bỏ qua kèm cảnh báo Telegram —
  đây là giới hạn cố ý, không phải lỗi.

## Việc KHÔNG được làm

- Không tạo file `.bat` mới — dùng đúng cơ chế `run-job.ps1` hiện có.
- Không đổi lịch của `"analyze-smc"` (hệ SMC, ngoài scope).
- Không tự ý chạy `register-tasks.ps1`/`unregister-tasks.ps1` thật trên máy Windows (Worker có thể
  không có quyền Administrator hoặc không phải đúng máy triển khai) — chỉ sửa file, không thực thi
  đăng ký task thật. Nếu môi trường cho phép, có thể chạy `powershell.exe -NoProfile -File
  register-tasks.ps1 -WhatIf` kiểu dry-run NẾU script hỗ trợ, nhưng không bắt buộc.
- Không đổi `CHART_PRIMARY_TIMEFRAME` mặc định trong `.env`/`.env.example`.

## Kiểm tra hoàn thành

1. Đọc lại `run-job.ps1`, `register-tasks.ps1`, `README.md` sau khi sửa — xác nhận tên job nhất
   quán ở CẢ 3 file (không còn chỗ nào tham chiếu tên `"analyze"` cũ nếu đã đổi thành
   `"analyze-volman-h4"`).
2. Nếu có PowerShell khả dụng trong môi trường Worker: chạy cú pháp kiểm tra file không lỗi, ví dụ
   `powershell -NoProfile -Command "Get-Content deploy\windows\run-job.ps1 | Out-Null"` hoặc dùng
   `PSScriptAnalyzer` nếu có sẵn trong dự án (kiểm tra `package.json`/`devDependencies` trước, đừng
   cài mới nếu không cần).
3. `npx vitest run` — pass toàn bộ (đảm bảo không có test nào tham chiếu tên job cũ).

## Ghi kết quả

Ghi vào `result.md`: nội dung diff của cả 3 file đã sửa, tên 3 job cuối cùng, lịch trigger của
từng job.
