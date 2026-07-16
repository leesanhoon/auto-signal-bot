# Task 05 — Fix NativeCommandError khiến auto-update.ps1 luôn fail

## Bối cảnh / Root cause (đã verify bằng log thật trên mini PC)

`deploy/windows/auto-update.ps1` được cả Task Scheduler (poll, đã gỡ ở subtask 04) lẫn workflow
`.github/workflows/deploy-selfhosted.yml` (push-trigger, subtask 01) gọi để tự pull code. Log thật
lấy từ mini PC (`C:\project\auto-signal-bot\logs\auto-update-*.log`) cho thấy **MỌI lần chạy từ
trước tới giờ đều fail**, với nội dung log:

```
[2026-07-16T21:11:59...] LỖI: From https://github.com/leesanhoon/auto-signal-bot
```

Dòng `"From https://github.com/leesanhoon/auto-signal-bot"` chính là dòng thông tin **bình thường**
mà `git fetch`/`git pull` in ra (theo sau thường có dòng `xxxxxxx..yyyyyyy main -> origin/main`) —
git luôn ghi loại output này ra **stderr** theo thiết kế, không phải lỗi thật.

**Root cause:** Dòng 7 của `auto-update.ps1` set `$ErrorActionPreference = "Stop"` cho TOÀN BỘ
script. Trên Windows PowerShell 5.1 (`shell: powershell` trong workflow, và Task Scheduler cũng
chạy `powershell.exe`), khi `$ErrorActionPreference = "Stop"`, bất kỳ output nào của native command
(git.exe, npm.cmd) ghi ra stderr sẽ bị PowerShell coi là NativeCommandError và ném exception chặn
script — **kể cả khi output đó đã được redirect bằng `*>>` vào file log** (redirect không ngăn được
hành vi ném exception này, nó chỉ quyết định output cuối cùng đi đâu).

Đây CHÍNH XÁC là vấn đề mà `deploy/windows/run-job.ps1` (dòng ~67-68) đã né sẵn:

```powershell
# Chạy qua cmd để gộp stdout+stderr vào log sạch sẽ (tránh NativeCommandError của PS5.1)
cmd /c "$npmCmd >> `"$log`" 2>&1"
```

`auto-update.ps1` KHÔNG áp dụng cách né này cho các lệnh `git fetch`/`git pull`/`npm ci`/
`npx playwright install`, nên mỗi khi các lệnh này in bất kỳ dòng nào ra stderr (git fetch/pull
LUÔN làm vậy khi có commit mới — đây là hành vi bình thường không thể tắt), script bị crash giữa
chừng, rơi vào `catch { Log "LỖI: $_" }`, và kết thúc với exit code khác 0 do `$LASTEXITCODE` còn
sót lại từ lệnh git vừa "thất bại" (thực ra chỉ là bị PowerShell hiểu nhầm).

Hệ quả: code trên mini PC **chưa bao giờ được auto-update.ps1 pull thành công**, kể cả trước khi
setup GitHub Actions runner (HEAD trên server đang kẹt ở 1 commit rất cũ, `131137b`).

## Yêu cầu implementation

Sửa **duy nhất** file `deploy/windows/auto-update.ps1`. Giữ nguyên toàn bộ logic nghiệp vụ (những
gì script làm, thứ tự các bước, nội dung message log, comment đầu file) — CHỈ sửa cách xử lý
`$ErrorActionPreference` để native command stderr không còn bị hiểu nhầm thành lỗi chặn script,
trong khi việc phát hiện lỗi THẬT vẫn dựa đúng vào `$LASTEXITCODE` (logic `if ($LASTEXITCODE -ne 0)
{ throw ... }` đã có sẵn, đúng ý đồ ban đầu của tác giả — chỉ là bị `$ErrorActionPreference = "Stop"`
toàn cục pre-empt trước khi kịp chạy tới các dòng check đó).

### Thay đổi cụ thể

1. **Dòng 8-9** (`$repo = (Resolve-Path ...).Path` và `Set-Location $repo`) — đây là PowerShell
   cmdlet (không phải native exe), CẦN giữ hành vi fail-fast nếu path không resolve được. Thêm rõ
   `-ErrorAction Stop` vào `Resolve-Path` để không phụ thuộc vào `$ErrorActionPreference` toàn cục
   nữa:

   ```powershell
   $repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..") -ErrorAction Stop).Path
   Set-Location $repo
   ```

2. **Ngay sau dòng 7** (`$ErrorActionPreference = "Stop"`), đổi giá trị này thành `"Continue"` —
   nhưng chỉ áp dụng SAU KHI đã xử lý xong 2 dòng Resolve-Path/Set-Location ở bước 1 (đặt đúng vị
   trí để 2 dòng đó vẫn dùng "Stop" tường minh qua `-ErrorAction Stop`, còn phần còn lại của script
   chạy dưới "Continue"). Cụ thể, cấu trúc đầu file sau khi sửa:

   ```powershell
   $ErrorActionPreference = "Stop"
   $repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..") -ErrorAction Stop).Path
   Set-Location $repo

   # Continue thay vì Stop: git/npm ghi thông tin (không phải lỗi) ra stderr là chuyện bình thường,
   # PS5.1 sẽ biến nó thành NativeCommandError chặn script nếu để "Stop" — lỗi THẬT vẫn được bắt
   # đúng qua các check "if ($LASTEXITCODE -ne 0) { throw ... }" bên dưới, không phụ thuộc dòng này.
   $ErrorActionPreference = "Continue"

   $logDir = Join-Path $repo "logs"
   ...
   ```

3. **KHÔNG đổi** bất kỳ dòng nào khác: giữ nguyên toàn bộ nội dung trong `try { ... } catch { ... }`,
   giữ nguyên các message log, giữ nguyên logic `$lockChanged`, `npm ci`, `playwright install`, phần
   dọn log cuối file.

### KHÔNG được làm

- Không đổi `deploy/windows/run-job.ps1`, `update.ps1`, `register-tasks.ps1`,
  `.github/workflows/deploy-selfhosted.yml` — chỉ đụng `auto-update.ps1`.
- Không đổi cách gọi git (không chuyển sang `cmd /c` như `run-job.ps1` — cách đó cũng đúng nhưng
  task này chọn giải pháp tối thiểu, ít thay đổi nhất; không tự ý đổi sang cách khác).
- Không thêm `-Quiet`/`2>$null` để "tắt tiếng" stderr của git — sẽ làm mất thông tin hữu ích trong
  log khi debug sau này. Chỉ đổi `$ErrorActionPreference`, không thêm redirect mới.
- Không đổi comment đầu file (dòng 1-5) trừ khi cần thêm 1 dòng giải thích ngắn gọn về
  `$ErrorActionPreference = "Continue"` (không bắt buộc, tuỳ ý).

## Verify trước khi báo cáo hoàn thành

1. Đọc lại toàn bộ file sau khi sửa — xác nhận cấu trúc đúng như mục "Thay đổi cụ thể" ở trên.
2. `git diff deploy/windows/auto-update.ps1` — chỉ đổi 2-3 dòng đầu file (Resolve-Path thêm
   `-ErrorAction Stop`, thêm dòng `$ErrorActionPreference = "Continue"`), không đụng phần còn lại
   của file (dòng 19 trở đi giữ nguyên 100%).
3. Không có cách nào chạy thử thật trên máy dev (không phải mini PC, không có git remote cấu hình
   credential thật giống server) — ghi rõ trong result.md rằng việc verify thực tế (chạy trên mini
   PC, xác nhận log không còn dòng "LỖI: From ...", xác nhận `git log -1` trên mini PC tiến lên
   commit mới) sẽ do user tự làm sau khi merge, không phải phần Worker verify được.
4. Nếu có thể, viết 1 đoạn PowerShell nhỏ mô phỏng lại tình huống (native command ghi stderr dưới
   `$ErrorActionPreference = "Continue"` không throw, còn dưới `"Stop"` thì throw) chạy thử ngay
   trên máy dev để tự confirm hiểu đúng cơ chế trước khi kết luận — không bắt buộc nhưng khuyến
   khích, ghi lại kết quả nếu làm.

## Ghi kết quả

Ghi vào `tasks/self-hosted-runner-deploy/05-fix-nativecommanderror-auto-update/result.md`:
- Diff đầy đủ của `auto-update.ps1`.
- Xác nhận không đụng file nào khác.
- Ghi rõ: cần user tự verify trên mini PC sau khi deploy (không tự verify được từ máy dev).
- Nếu bị chặn → ghi `blocked.md` thay vì đoán.
