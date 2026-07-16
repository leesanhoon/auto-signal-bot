# Task 03 — Runbook: cài GitHub Actions self-hosted runner trên mini PC

**Đây KHÔNG phải task code.** Không giao cho Worker chat — chạy trực tiếp trên chính mini PC
Windows Server 2019 đang chạy bot (nơi có `C:\bots\auto-signal-bot`), bằng PowerShell quyền
Administrator. Máy dev hiện tại (nơi viết code) không có quyền truy cập vật lý mini PC đó.

Điều kiện tiên quyết: đã hoàn tất subtask 01 + 04 (workflow đã merge vào `main`, không còn poll
schedule), và `gh` CLI đã đăng nhập trên máy dùng để lấy registration token (hoặc lấy token thủ công
qua GitHub UI — xem bước 2b).

**Lưu ý — máy đã có runner của dự án khác**: mỗi máy chạy được nhiều self-hosted runner cùng lúc,
mỗi runner đăng ký cho 1 repo riêng, miễn **mỗi runner nằm trong 1 thư mục cài đặt riêng** (không
dùng chung folder với runner có sẵn — sẽ đè cấu hình/service của nó). Service Windows được
`config.cmd --runasservice` tự đặt tên duy nhất theo dạng `actions.runner.<owner>-<repo>.<runner-name>`
nên không trùng tên với service của runner cũ. Không cần mở port, không xung đột network — mỗi
runner chỉ long-poll ra ngoài tới GitHub.

## Bước 1 — Tạo thư mục runner

Trên mini PC, PowerShell Administrator. Dùng tên thư mục **riêng cho repo này**, không phải
`C:\actions-runner` chung chung (để không đụng runner dự án khác đã có sẵn):

```powershell
mkdir C:\actions-runner-auto-signal-bot; cd C:\actions-runner-auto-signal-bot
```

## Bước 2 — Tải runner package

Vào https://github.com/leesanhoon/auto-signal-bot/settings/actions/runners/new để lấy đúng link
tải bản mới nhất cho Windows x64 (link đổi theo version, không hardcode ở đây). Hoặc dùng lệnh
GitHub cung cấp sẵn trên trang đó (dạng `Invoke-WebRequest ... -OutFile actions-runner-win-x64-*.zip`
rồi giải nén bằng `Expand-Archive`).

## Bước 2b — Lấy registration token

**Cách tự động** (nếu máy chạy lệnh này có `gh` CLI đã đăng nhập với quyền admin repo — có thể chạy
trên máy dev rồi copy token sang mini PC, token dùng 1 lần, hết hạn sau ~1 giờ):

```bash
gh api -X POST repos/leesanhoon/auto-signal-bot/actions/runners/registration-token --jq .token
```

**Cách thủ công**: mở trang
https://github.com/leesanhoon/auto-signal-bot/settings/actions/runners/new , GitHub hiển thị sẵn
đoạn lệnh `config.cmd` kèm token — copy nguyên đoạn đó chạy ở bước 3, khỏi cần lấy token riêng.

## Bước 3 — Đăng ký runner (trên mini PC)

```powershell
cd C:\actions-runner-auto-signal-bot
.\config.cmd --url https://github.com/leesanhoon/auto-signal-bot --token <TOKEN_TU_BUOC_2b> --name auto-signal-bot-runner --labels self-hosted,Windows --runasservice --unattended
```

Lưu ý các flag bắt buộc:
- `--name auto-signal-bot-runner` — đặt tên **khác** với runner dự án kia (ví dụ nếu runner cũ tên
  `minipc-runner` thì không dùng lại tên đó) — tên này quyết định tên service Windows, trùng tên sẽ
  gây lỗi đăng ký hoặc đè service cũ.
- `--runasservice` — cài chạy như Windows service, không cần đăng nhập, tự chạy khi máy reboot
  (đồng bộ với cách các scheduled task hiện tại chạy dưới tài khoản SYSTEM).
- `--unattended` — không hỏi tương tác, dùng được trong script.
- `--labels self-hosted,Windows` — khớp đúng `runs-on: [self-hosted, Windows]` trong
  `.github/workflows/deploy-selfhosted.yml` (task 01). Không cần thêm label khác vì runner này chỉ
  phục vụ đúng repo `auto-signal-bot` (đăng ký ở cấp repo, GitHub tự route job đúng runner theo
  repo, không lẫn với runner của dự án khác dù cùng label `self-hosted,Windows`).
- Khi được hỏi user chạy service (nếu `--unattended` vẫn dừng lại hỏi), dùng tài khoản mặc định
  `NT AUTHORITY\NETWORK SERVICE` hoặc để trống theo gợi ý mặc định của `config.cmd` — không dùng
  tài khoản cá nhân.

## Bước 4 — Xác nhận service đã chạy

```powershell
Get-Service "actions.runner.*"
```
Kỳ vọng: thấy **cả 2 service** (runner dự án kia + `actions.runner.leesanhoon-auto-signal-bot.*`
của runner mới), cả 2 đều `Status = Running`. Nếu chỉ thấy 1 service hoặc service cũ bị mất, kiểm
tra lại đã đăng ký đúng trong thư mục riêng (`C:\actions-runner-auto-signal-bot`) chứ không đè lên
thư mục runner cũ.

Trên GitHub: https://github.com/leesanhoon/auto-signal-bot/settings/actions/runners phải thấy
runner với status **Idle** (màu xanh).

## Bước 5 — Test end-to-end

1. Trên máy dev, push 1 commit nhỏ (ví dụ sửa comment) lên `main`.
2. Vào https://github.com/leesanhoon/auto-signal-bot/actions — xác nhận workflow
   "Deploy (self-hosted mini PC)" tự chạy, job chọn đúng runner `auto-signal-bot-runner`, step
   "Pull latest code + sync dependencies" xanh (success).
3. Trên mini PC: `cd C:\bots\auto-signal-bot; git log -1` — xác nhận HEAD khớp đúng commit vừa push.
4. Xem log: `Get-Content C:\bots\auto-signal-bot\logs\auto-update-*.log -Tail 20` — xác nhận có dòng
   ghi nhận commit mới được pull.

## Rollback nếu cần gỡ

```powershell
cd C:\actions-runner-auto-signal-bot
.\config.cmd remove --token <TOKEN_MOI_LAY_LAI_TU_BUOC_2b>
```
Chỉ gỡ đúng service/thư mục của runner này (`C:\actions-runner-auto-signal-bot`), KHÔNG đụng tới
thư mục hay service của runner dự án khác. Chạy
`Get-Service "actions.runner.leesanhoon-auto-signal-bot.*" | Stop-Service` trước nếu service đang
chạy (chỉ định rõ tên để không lỡ dừng nhầm service của runner kia).

## Ghi kết quả

Người thực hiện (user, trực tiếp trên mini PC) tự xác nhận đủ 5 bước ở "Bước 5 — Test end-to-end"
đã pass trước khi coi task này hoàn tất. Không cần ghi `result.md` theo format Worker thông thường
— chỉ cần báo lại trong chat khi đã làm xong để Lead review tổng thể (task 01 + 02 + 03).
