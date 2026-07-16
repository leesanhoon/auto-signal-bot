# Task 01 — Tạo workflow deploy trên self-hosted runner

## Bối cảnh

Repo `leesanhoon/auto-signal-bot` deploy trên 1 mini PC Windows Server 2019, code sống tại
`C:\bots\auto-signal-bot` trên máy đó (xem `deploy/windows/README.md`). Hiện tại code mới chỉ được
pull tự động mỗi 15 phút qua Windows Task Scheduler (`deploy/windows/auto-update.ps1`). Mini PC sẽ
được cài GitHub Actions self-hosted runner (việc cài đặt KHÔNG thuộc task này — task khác lo).
Task này chỉ tạo file workflow để khi runner đã sẵn sàng, mỗi lần push vào `main` sẽ tự trigger
pull code ngay lập tức trên chính runner đó.

Đã có sẵn script idempotent `deploy/windows/auto-update.ps1` — đọc file này trước khi làm (đường
dẫn: `H:\LeeSanHoon\auto-signal-bot\deploy\windows\auto-update.ps1` nếu bạn chạy trên máy dev, hoặc
tương ứng trong repo bạn đang thao tác). Script này:
- Tự resolve đường dẫn repo dựa vào vị trí của chính nó (`$PSScriptRoot\..\..`).
- `git fetch origin main`, so `HEAD` hiện tại với `origin/main`, nếu khác thì `git pull --ff-only`.
- Chỉ chạy `npm ci` + cài lại Chromium nếu `package-lock.json` thay đổi giữa 2 commit.
- Không throw ra ngoài — lỗi được ghi vào `logs\auto-update-YYYY-MM-DD.log`, exit code luôn 0
  (script tự catch exception, xem dòng `catch { Log "LỖI: $_" }`).

## Yêu cầu implementation

Tạo file mới `.github/workflows/deploy-selfhosted.yml` với nội dung sau (điều chỉnh nếu cần nhưng
PHẢI giữ đúng các điểm bắt buộc liệt kê bên dưới):

```yaml
name: Deploy (self-hosted mini PC)

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: [self-hosted, Windows]
    timeout-minutes: 15

    steps:
      - name: Pull latest code + sync dependencies
        shell: powershell
        run: |
          & "C:\bots\auto-signal-bot\deploy\windows\auto-update.ps1"
```

### Bắt buộc

1. **KHÔNG thêm step `actions/checkout`** — job này cố tình không tạo bản clone riêng của runner
   trong `_work\`. Toàn bộ thao tác git diễn ra trực tiếp trong `C:\bots\auto-signal-bot` (thư mục
   duy nhất mà Task Scheduler trên mini PC cũng đang dùng).
2. `runs-on: [self-hosted, Windows]` — đúng cú pháp array, không phải string đơn `self-hosted`.
3. Trigger: `push` vào branch `main` + `workflow_dispatch` (để test tay khi cần). KHÔNG thêm
   `pull_request` (tránh chạy deploy cho code chưa merge).
4. Đường dẫn tới `auto-update.ps1` phải là đường dẫn tuyệt đối cố định
   `C:\bots\auto-signal-bot\deploy\windows\auto-update.ps1` — KHÔNG dùng biến
   `${{ github.workspace }}` (vì không checkout nên biến đó trỏ vào thư mục rỗng, không phải nơi
   code thật nằm).
5. `shell: powershell` (Windows PowerShell 5.1 có sẵn trên Windows Server 2019, không phải `pwsh`).
6. Không sửa `deploy/windows/auto-update.ps1`, `update.ps1`, `run-job.ps1`, `register-tasks.ps1`
   trong task này (task khác — 02 — sẽ đụng `register-tasks.ps1`).
7. Không sửa các workflow khác trong `.github/workflows/`.

## Verify trước khi báo cáo hoàn thành

1. Validate YAML hợp lệ, ví dụ:
   ```bash
   npx js-yaml .github/workflows/deploy-selfhosted.yml
   ```
   (hoặc bất kỳ cách nào khác để confirm parse được — ghi rõ cách bạn dùng vào result.md)
2. `git status` / `git diff` — xác nhận CHỈ có 1 file mới `.github/workflows/deploy-selfhosted.yml`,
   không đụng file nào khác.
3. Đọc lại nội dung file đã tạo, so khớp với 7 điểm bắt buộc ở trên.

## Ghi kết quả

Ghi vào `tasks/self-hosted-runner-deploy/01-add-deploy-workflow/result.md`:
- Nội dung file đã tạo (hoặc diff).
- Kết quả validate YAML.
- Xác nhận `git status` chỉ có đúng 1 file mới.
- Nếu bị chặn → ghi `blocked.md` thay vì đoán.
