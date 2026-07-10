# Deploy trên Mini PC Windows Server 2019 — KHÔNG cần Docker

Chạy bot trực tiếp bằng Node.js trên Windows, lập lịch bằng **Task Scheduler** có sẵn của Windows. Không cần Hyper-V, không cần Docker.

## Cần cài trước

1. **Git for Windows** — https://git-scm.com/download/win
2. **Node.js 20 LTS** (bản Windows x64 MSI) — https://nodejs.org
   - Cài mặc định là đủ (tự thêm vào PATH máy, tài khoản SYSTEM cũng thấy).

## Cài đặt (chạy 1 lần)

Mở **PowerShell với quyền Administrator**:

```powershell
# 1. Đặt timezone giờ VN (lịch trong register-tasks.ps1 tính theo UTC+7)
Set-TimeZone -Id "SE Asia Standard Time"

# 2. Clone repo (chọn thư mục cố định, ví dụ C:\bots)
mkdir C:\bots; cd C:\bots
git clone https://github.com/<owner>/auto-signal-bot.git
cd auto-signal-bot

# 3. Cài dependencies + Chromium cho Playwright (job "analyze" cần)
npm ci
$env:PLAYWRIGHT_BROWSERS_PATH = "C:\bots\auto-signal-bot\.playwright-browsers"
npx playwright install chromium

# 4. Tạo file secrets
copy .env.example .env
notepad .env   # điền giá trị thật (chép từ GitHub -> Settings -> Secrets and variables -> Actions)

# 5. Đăng ký toàn bộ lịch vào Task Scheduler
.\deploy\windows\register-tasks.ps1
```

## Kiểm tra

```powershell
# Danh sách task đã đăng ký (13 task trong folder \AutoSignalBot\)
Get-ScheduledTask -TaskPath "\AutoSignalBot\"

# Chạy thử ngay một job, không chờ lịch
Start-ScheduledTask -TaskPath "\AutoSignalBot\" -TaskName "analyze-smc"

# Xem log (mỗi job 1 file theo ngày, tự xoá sau 30 ngày)
Get-Content .\logs\analyze-smc-*.log -Tail 50

# Xem lần chạy gần nhất + kết quả (0 = thành công)
Get-ScheduledTask -TaskPath "\AutoSignalBot\" | Get-ScheduledTaskInfo |
    Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime
```

Hoặc chạy tay không qua Task Scheduler: `.\deploy\windows\run-job.ps1 -Job analyze-smc`

## Cập nhật code

Khi có commit mới trên `main`:

```powershell
cd C:\bots\auto-signal-bot
.\deploy\windows\update.ps1
```

(Không cần đăng ký lại task — task chỉ gọi `run-job.ps1`, lần chạy kế tiếp tự dùng code mới. Chỉ chạy lại `register-tasks.ps1` khi **lịch** thay đổi.)

## Lịch chạy (giờ VN, đã quy đổi từ UTC của GitHub Actions)

| Task | Lịch (giờ VN) | Gốc UTC |
|---|---|---|
| analyze | 07:05, 11:05, 15:05, 19:05, 23:05 (T2–T6) + 03:05 (T3–T7) | 00:05,04:05…20:05 T2–T6 |
| analyze-smc | mỗi 15 phút, từ T2 07:00 đến T7 06:45 | */15 T2–T6 |
| fetch-matches-list | 07:00 hằng ngày | 00:00 |
| match-odds | 12:00 hằng ngày | 05:00 |
| performance-report-weekly | T2 08:15 | T2 01:15 |
| performance-report-monthly | 08:20 ngày 1 (trigger daily + guard trong script) | ngày 1, 01:20 |
| lottery | 19:00 hằng ngày | 12:00 |
| lottery-predict (MN/MT/MB) | 16:45 / 17:45 / 18:45 | 09:45/10:45/11:45 |
| lottery-verify (MN/MT/MB) | 16:45 / 17:45 / 18:50 | 09:45/10:45/11:50 |

Ghi chú kỹ thuật:

- Task chạy dưới tài khoản **SYSTEM** → không cần đăng nhập, chạy cả khi máy khoá màn hình. Máy chỉ cần bật nguồn (tắt Sleep trong Power Options).
- Task đặt `StartWhenAvailable` → nếu máy đang tắt/restart đúng giờ chạy, job sẽ chạy bù ngay khi máy lên lại.
- `MultipleInstances = IgnoreNew` → không chạy chồng (tương đương `concurrency` của GitHub Actions).
- Secrets nằm trong `.env` tại thư mục repo (đã gitignore).

## Gỡ toàn bộ lịch

```powershell
.\deploy\windows\unregister-tasks.ps1
```

## Tắt lịch trên GitHub Actions

Khi mini PC đã chạy ổn, xoá block `schedule:` trong `.github/workflows/*.yml` (giữ `workflow_dispatch:` làm dự phòng chạy tay khi mini PC bảo trì). Nếu chạy song song hai bên vài ngày: dedup qua Supabase chặn phần lớn tín hiệu trùng, nhưng hai run trùng thời điểm vẫn có thể gửi Telegram trùng.
