# Task 02 — Hạ tần suất poll fallback của task `auto-update`

## Bối cảnh

Task 01 (đã/đang làm song song) thêm workflow GitHub Actions trigger tức thời khi push — đây sẽ là
đường chính để cập nhật code trên mini PC. Task Scheduler hiện đăng ký task `auto-update` chạy mỗi
**15 phút** (poll) trong `deploy/windows/register-tasks.ps1`, dòng 118-134:

```powershell
# === Auto-update ===

# Tự pull code mới mỗi 15 phút.
# Chỉ git pull + (nếu package-lock.json đổi) npm ci — xem auto-update.ps1.
$autoUpdate = (Resolve-Path (Join-Path $PSScriptRoot "auto-update.ps1")).Path
$autoUpdateAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$autoUpdate`""
Register-ScheduledTask `
    -TaskName "auto-update" `
    -TaskPath $taskPath `
    -Action $autoUpdateAction `
    -Trigger (Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 15 (New-TimeSpan -Days 1)) `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null
Write-Host "Registered: ${taskPath}auto-update"
```

Giờ push-trigger qua Actions runner (task 01) là đường chính, cập nhật gần như tức thời. Poll 15
phút không còn cần thiết dày như vậy — chỉ giữ làm **lưới an toàn** (fallback) cho trường hợp
runner offline (máy restart, mất mạng, service runner dừng, v.v.). Hạ xuống mỗi 4 giờ là đủ.

## Yêu cầu implementation

### 1. `deploy/windows/register-tasks.ps1`

Đổi `240` thay cho `15` trong dòng `Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 15 (New-TimeSpan -Days 1)` ở block `auto-update` (dòng ~130). Đổi comment phía trên (dòng
"Tự pull code mới mỗi 15 phút.") thành mô tả đúng: đây là fallback poll mỗi 4 giờ, đường chính là
push-trigger qua GitHub Actions self-hosted runner (workflow
`.github/workflows/deploy-selfhosted.yml`).

**KHÔNG đổi** bất kỳ `Register-BotTask` nào khác trong file này (`analyze-volman-*`,
`fetch-matches-list`, `match-odds`, `lottery-*`) — chỉ đụng đúng block `auto-update`.

### 2. `deploy/windows/README.md`

Trong mục "## Cập nhật code — tự động" (dòng ~56-66), cập nhật nội dung để phản ánh đúng kiến trúc
2 lớp:

- **Lớp chính**: push vào `main` → GitHub Actions workflow `deploy-selfhosted.yml` chạy trên
  self-hosted runner cài tại mini PC → gọi `auto-update.ps1` ngay lập tức (độ trễ chỉ vài giây tới
  vài chục giây, tuỳ thời gian runner nhận job).
- **Lớp fallback**: task Task Scheduler `auto-update` vẫn chạy poll mỗi **4 giờ** (đã đổi ở bước
  1), phòng trường hợp runner offline không nhận được push event.

Xoá câu sai hiện tại "chậm nhất 02:00 đêm đó mini PC tự cập nhật" (không khớp code — code chạy poll
15 phút, không phải 1 lần lúc 02:00) — thay bằng mô tả đúng ở trên. Giữ nguyên phần "Rủi ro thấp và
tự phục hồi..." nếu vẫn đúng ngữ cảnh (điều chỉnh số phút nếu cần cho khớp 4 giờ thay vì 15 phút).

Không sửa các phần khác của README (bảng lịch chạy, phần cài đặt lần đầu, v.v.) trừ khi trực tiếp
liên quan tới đoạn auto-update này.

## Verify trước khi báo cáo hoàn thành

1. `git diff deploy/windows/register-tasks.ps1` — chỉ đổi số `15` → `240` + comment liên quan
   trong block `auto-update`, không đụng block nào khác.
2. `git diff deploy/windows/README.md` — chỉ đổi đoạn mô tả auto-update, không đụng phần khác.
3. Đọc lại toàn bộ `register-tasks.ps1` sau khi sửa, xác nhận cú pháp PowerShell không lỗi (không
   cần chạy thật trên Windows Task Scheduler vì máy dev không phải mini PC — chỉ cần review bằng
   mắt + kiểm tra không có typo/ngoặc lệch).

## Ghi kết quả

Ghi vào `tasks/self-hosted-runner-deploy/02-adjust-fallback-poll-interval/result.md`:
- Diff đầy đủ của 2 file.
- Xác nhận không đụng job nghiệp vụ nào khác.
- Nếu bị chặn → ghi `blocked.md` thay vì đoán.
