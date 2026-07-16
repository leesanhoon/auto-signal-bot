# Task 04 — Bỏ hẳn poll schedule `auto-update` (chỉ giữ push-trigger)

## Bối cảnh

Subtask 03 (cài GitHub Actions self-hosted runner trên mini PC) đã hoàn tất — user xác nhận runner
đang chạy, push vào `main` đã tự trigger `deploy-selfhosted.yml` và pull code thật thành công
(xem `tasks/self-hosted-runner-deploy/03-install-runner-on-minipc/task.md`).

Trước đó subtask 02 hạ tần suất poll Task Scheduler `auto-update` từ 15 phút xuống 4 giờ, giữ làm
fallback phòng khi runner offline. User giờ quyết định: **không cần giữ fallback poll nữa** — bỏ
hẳn task `auto-update` khỏi Task Scheduler, chỉ dùng đúng 1 đường: push → GitHub Actions
self-hosted runner → `auto-update.ps1`.

**Lưu ý quan trọng**: chỉ xoá phần **đăng ký task Task Scheduler**, KHÔNG xoá file
`deploy/windows/auto-update.ps1` — script này vẫn là phần logic thật được
`.github/workflows/deploy-selfhosted.yml` gọi trực tiếp (xem `run:` step trong file đó, gọi thẳng
đường dẫn `C:\bots\auto-signal-bot\deploy\windows\auto-update.ps1`). Xoá file này sẽ làm hỏng
workflow.

## Yêu cầu implementation

### 1. `deploy/windows/register-tasks.ps1`

Xoá toàn bộ block `# === Auto-update ===` (hiện ở cuối file, ngay trước phần `Write-Host ""` kết
thúc script) — gồm comment, biến `$autoUpdate`, `$autoUpdateAction`, và lệnh
`Register-ScheduledTask -TaskName "auto-update" ...` cùng dòng `Write-Host "Registered:
${taskPath}auto-update"`.

Giữ nguyên comment mở đầu file (dòng 1-16, giải thích chung về script) và TẤT CẢ các
`Register-BotTask` khác (`analyze-volman-*`, `fetch-matches-list`, `match-odds`,
`performance-report-*`, `lottery-*`) — không đụng.

Dòng `Write-Host ""` / `Write-Host "Xong. Kiểm tra: ..."` / `Write-Host "Chạy thử ngay: ..."` ở
cuối file giữ nguyên, chỉ liền ngay sau block lottery (bỏ đoạn auto-update ở giữa).

### 2. `deploy/windows/README.md`

Trong mục "## Cập nhật code — tự động" (hiện đang mô tả kiến trúc 2 lớp: push-trigger chính +
poll 4 giờ fallback), xoá phần "Lớp fallback (poll)" — chỉ còn lại mô tả push-trigger là đường
DUY NHẤT:

- Push vào `main` → GitHub Actions workflow `deploy-selfhosted.yml` chạy trên self-hosted runner
  (đã cài tại mini PC, xem runbook `tasks/self-hosted-runner-deploy/03-install-runner-on-minipc/task.md`
  nếu cần cài lại) → gọi `auto-update.ps1` ngay lập tức.
- Giữ nguyên đoạn mô tả `auto-update.ps1` làm gì (fetch, so sánh HEAD, pull, npm ci có điều kiện) —
  đoạn này vẫn đúng, script không đổi.
- Bỏ câu về "poll 4 giờ", "runner offline", "trùng lúc job khác đọc file nguồn" — không còn liên
  quan vì không còn poll nữa.
- Thêm 1 dòng ghi chú: nếu runner tự dưng offline (máy restart, service dừng, mất mạng), code sẽ
  KHÔNG tự cập nhật cho tới khi runner online lại và có push mới — không còn lưới an toàn dạng
  poll. Nếu cần chắc chắn code luôn mới, `Get-Service "actions.runner.*"` để kiểm tra service còn
  chạy.

Trong mục "## Kiểm tra" (dòng ~40), sửa comment "10 task trong folder `\AutoSignalBot\`, gồm cả
auto-update" → cập nhật đúng số lượng task còn lại (đếm số `Register-BotTask` còn trong
`register-tasks.ps1` sau khi xoá block auto-update — không cần ghi số cứng nếu không chắc, có thể
bỏ số và chỉ ghi "toàn bộ task đã đăng ký").

### 3. Ghi chú gỡ task cũ trên mini PC (chỉ thêm text, không phải code)

Vì task `auto-update` có thể đã được đăng ký thật trên mini PC từ lần chạy `register-tasks.ps1`
trước (khi còn ở bản 15 phút/240 phút), thêm 1 đoạn ngắn vào README (ngay dưới mục "## Gỡ toàn bộ
lịch", trước "## Tắt lịch trên GitHub Actions") hướng dẫn user tự gỡ RIÊNG task `auto-update` đã có
sẵn trên mini PC (không chạy `unregister-tasks.ps1` vì sẽ gỡ hết mọi job nghiệp vụ khác):

```powershell
Unregister-ScheduledTask -TaskName "auto-update" -TaskPath "\AutoSignalBot\" -Confirm:$false
```

Ghi chú: chỉ cần chạy 1 lần trên mini PC nếu task đó đã tồn tại; không bắt buộc chạy lại toàn bộ
`register-tasks.ps1`.

## KHÔNG được đổi

- `deploy/windows/auto-update.ps1` — giữ nguyên, vẫn cần cho workflow.
- `.github/workflows/deploy-selfhosted.yml` — không đụng file này.
- Bất kỳ `Register-BotTask` nghiệp vụ nào khác trong `register-tasks.ps1`.
- Phần "Lịch chạy (giờ VN...)" và các mục khác của README không liên quan tới auto-update.

## Verify trước khi báo cáo hoàn thành

1. `git diff deploy/windows/register-tasks.ps1` — xác nhận block `# === Auto-update ===` bị xoá
   hoàn toàn, không còn dòng nào tham chiếu `$autoUpdate`/`auto-update.ps1` trong file này; các
   block khác không đổi 1 ký tự.
2. `git diff deploy/windows/README.md` — xác nhận chỉ đổi mục auto-update + dòng ghi chú số task,
   không đụng phần khác.
3. Đọc lại toàn bộ `register-tasks.ps1` sau khi sửa — xác nhận cú pháp PowerShell hợp lệ (không có
   dấu ngoặc/backtick lệch do xoá nhầm block).
4. Confirm `deploy/windows/auto-update.ps1` KHÔNG bị đổi/xoá (`git status` không hiện file này).

## Ghi kết quả

Ghi vào `tasks/self-hosted-runner-deploy/04-remove-poll-schedule/result.md`:
- Diff đầy đủ của 2 file.
- Xác nhận `auto-update.ps1` không bị đụng.
- Xác nhận không đụng job nghiệp vụ nào khác.
- Nếu bị chặn → ghi `blocked.md` thay vì đoán.
