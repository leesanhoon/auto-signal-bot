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
# Danh sách task đã đăng ký (9 task trong folder \AutoSignalBot\)
Get-ScheduledTask -TaskPath "\AutoSignalBot\"

# Chạy thử ngay một job, không chờ lịch
Start-ScheduledTask -TaskPath "\AutoSignalBot\" -TaskName "analyze"

# Xem log (mỗi job 1 file theo ngày, tự xoá sau 30 ngày)
Get-Content .\logs\analyze-*.log -Tail 50

# Xem lần chạy gần nhất + kết quả (0 = thành công)
Get-ScheduledTask -TaskPath "\AutoSignalBot\" | Get-ScheduledTaskInfo |
    Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime
```

Hoặc chạy tay không qua Task Scheduler: `.\deploy\windows\run-job.ps1 -Job analyze`

## Cập nhật code — tự động

Cập nhật được thực hiện qua **đường chính duy nhất**:

Push vào `main` → GitHub Actions workflow `deploy-selfhosted.yml` chạy trên self-hosted runner (đã cài tại mini PC) → gọi `auto-update.ps1` ngay lập tức (độ trễ chỉ vài giây tới vài chục giây, tuỳ thời gian runner nhận job).

Script [auto-update.ps1](auto-update.ps1) thực hiện:

1. `git fetch` — nếu không có commit mới thì thoát, không làm gì cả.
2. Nếu có: `git pull --ff-only`.
3. Chỉ chạy `npm ci` + cài lại Chromium **nếu `package-lock.json` thực sự thay đổi** giữa 2 commit — tránh đụng `node_modules` không cần thiết.

Log ghi vào `logs\auto-update-YYYY-MM-DD.log`.

**Lưu ý:** Không còn lưới an toàn dạng poll. Nếu runner tự dưng offline (máy restart, service dừng, mất mạng), code sẽ KHÔNG tự cập nhật cho tới khi runner online lại và có push mới. Kiểm tra trạng thái runner bằng `Get-Service "actions.runner.*"` trên mini PC.

## Cập nhật code — chạy tay (bắt buộc npm ci)

Muốn ép cập nhật ngay, hoặc khi cần chắc chắn `npm ci` + Chromium chạy lại dù `package-lock.json` không đổi:

```powershell
cd C:\bots\auto-signal-bot
.\deploy\windows\update.ps1
```

(Không cần đăng ký lại task sau khi update code — task chỉ gọi `run-job.ps1`/`auto-update.ps1`, lần chạy kế tiếp tự dùng code mới. Chỉ chạy lại `register-tasks.ps1` khi **lịch** (giờ chạy) thay đổi.)

## Lịch chạy (giờ VN, đã quy đổi từ UTC của GitHub Actions)

| Task | Lịch (giờ VN) | Gốc UTC |
|---|---|---|
| analyze | 07:05, 11:05, 15:05, 19:05, 23:05 (T2–T6) + 03:05 (T3–T7) | 00:05,04:05…20:05 T2–T6 |
| **analyze-volman-m15** | **mỗi 15 phút, suốt ngày** | ***/15** |
| **analyze-volman-h1** | **mỗi 60 phút (1 giờ), suốt ngày** | ***/60** |
| **analyze-volman-h4** | **mỗi 240 phút (4 giờ), suốt ngày** | ***/240** |
| fetch-matches-list | 07:00 hằng ngày | 00:00 |
| match-odds | 12:00 hằng ngày | 05:00 |
| performance-report-weekly | T2 08:15 | T2 01:15 |
| performance-report-monthly | 08:20 ngày 1 (trigger daily + guard trong script) | ngày 1, 01:20 |
| lottery-verify (MN/MT/MB) | 16:40 / 17:40 / 18:40 | 09:40/10:40/11:40 |
| lottery-predict (cả 3 miền, 1 lần, sau khi verify xong) | 19:00 | 12:00 |

Ghi chú kỹ thuật:

- Task chạy dưới tài khoản **SYSTEM** → không cần đăng nhập, chạy cả khi máy khoá màn hình. Máy chỉ cần bật nguồn (tắt Sleep trong Power Options).
- Task đặt `StartWhenAvailable` → nếu máy đang tắt/restart đúng giờ chạy, job sẽ chạy bù ngay khi máy lên lại.
- `MultipleInstances = IgnoreNew` → không chạy chồng (tương đương `concurrency` của GitHub Actions).
- Secrets nằm trong `.env` tại thư mục repo (đã gitignore).

## Gỡ toàn bộ lịch

```powershell
.\deploy\windows\unregister-tasks.ps1
```

## Gỡ task `auto-update` đã đăng ký trước (chỉ cần chạy 1 lần)

Vì task `auto-update` có thể đã được đăng ký trên mini PC từ lần chạy `register-tasks.ps1` trước (khi còn là poll 4 giờ), nếu muốn gỡ riêng task này mà giữ các job khác, chạy:

```powershell
Unregister-ScheduledTask -TaskName "auto-update" -TaskPath "\AutoSignalBot\" -Confirm:$false
```

Ghi chú: chỉ cần chạy 1 lần trên mini PC nếu task đó đã tồn tại; không bắt buộc chạy lại toàn bộ `register-tasks.ps1`.

## Tắt lịch trên GitHub Actions

Khi mini PC đã chạy ổn, xoá block `schedule:` trong `.github/workflows/*.yml` (giữ `workflow_dispatch:` làm dự phòng chạy tay khi mini PC bảo trì). Nếu chạy song song hai bên vài ngày: dedup qua Supabase chặn phần lớn tín hiệu trùng, nhưng hai run trùng thời điểm vẫn có thể gửi Telegram trùng.
