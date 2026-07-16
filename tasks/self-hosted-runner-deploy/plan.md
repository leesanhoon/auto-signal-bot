# Plan — GitHub Actions self-hosted runner để auto-deploy khi push

## Bối cảnh hiện tại

Repo đã có cơ chế auto-pull code trên mini PC Windows Server 2019 (`deploy/windows/`):

- `register-tasks.ps1` đăng ký task Windows Task Scheduler `auto-update` chạy **mỗi 15 phút**
  (`deploy/windows/register-tasks.ps1` dòng 118-134), gọi `auto-update.ps1`.
- `auto-update.ps1` (`deploy/windows/auto-update.ps1`): `git fetch origin main` → so `HEAD` với
  `origin/main` → nếu khác thì `git pull --ff-only` → chỉ `npm ci` + cài lại Chromium **nếu
  `package-lock.json` thực sự đổi** giữa 2 commit.
- Đây là cơ chế **poll**, độ trễ tối đa 15 phút sau khi push. `deploy/windows/README.md` (dòng 56-66)
  mô tả sai là "mỗi đêm 02:00" — doc lỗi thời so với code thực tế, không sửa trong task này (ngoài scope).

User muốn nâng cấp: khi push code lên `main`, server **tự pull ngay lập tức** thay vì chờ tối đa
15 phút. Đã chọn giải pháp: **GitHub Actions self-hosted runner** cài trên chính mini PC, thay vì
webhook listener tự viết.

## Quyết định kiến trúc

1. **Không dùng `actions/checkout`** trong workflow mới. Runner sẽ không tự tạo bản clone riêng
   trong `_work/`. Thay vào đó, step của workflow gọi thẳng script đã có sẵn
   (`deploy/windows/auto-update.ps1`) bằng đường dẫn tuyệt đối tới thư mục bot đang chạy thật
   (`C:\bots\auto-signal-bot`, theo đúng path trong `deploy/windows/README.md` dòng 20-22).
   Lý do: tránh duy trì 2 bản clone song song (1 của runner, 1 của Task Scheduler) — chỉ 1 bản
   clone duy nhất mà cả Task Scheduler lẫn workflow mới đều dùng chung, giảm rủi ro lệch code.
2. **Giữ nguyên `auto-update.ps1`** — logic idempotent (fetch, so sánh HEAD với origin/main, chỉ
   `npm ci` khi lockfile đổi) đã đúng yêu cầu, dùng lại được nguyên vẹn cho cả 2 trigger (poll
   15 phút + push tức thời). Không cần viết script mới.
3. **Task Scheduler `auto-update` giữ lại làm fallback**, nhưng đổi tần suất từ 15 phút xuống
   thấp hơn (ví dụ mỗi 4 giờ) vì giờ đây trigger tức thời qua Actions là đường chính — fallback chỉ
   cần bắt các trường hợp runner offline (máy restart, mất mạng, runner service dừng) chứ không
   cần chạy dày mỗi 15 phút nữa.
4. Runner đăng ký **ở cấp repo** (không phải org), label mặc định `self-hosted` (+ `Windows`,
   `X64` do GitHub tự gắn) — không cần custom label vì runner này chỉ phục vụ đúng 1 repo.
5. Việc cài đặt runner là thao tác **hạ tầng vật lý trên mini PC thật** (không phải máy dev đang
   chạy Claude Code hiện tại — máy hiện tại không có `logs/` hay task nào đăng ký trong
   `\AutoSignalBot\`, tức đây là máy dev, không phải mini PC deploy). Bước này viết thành runbook
   (subtask 03) để user tự chạy trực tiếp trên mini PC, không giao cho Worker chat vì Worker cũng
   không có quyền truy cập vật lý máy đó.

## Mục tiêu

1. Thêm workflow GitHub Actions chạy trên self-hosted runner, trigger khi push vào `main`, gọi
   `auto-update.ps1` để pull + cập nhật dependency ngay lập tức.
2. Hạ tần suất poll fallback của Task Scheduler xuống mỗi 4 giờ (giữ làm lưới an toàn, không xoá).
3. Cung cấp runbook cài đặt + đăng ký GitHub Actions self-hosted runner trên mini PC Windows,
   chạy như Windows service (tự khởi động lại khi máy reboot, không cần đăng nhập).

**Không nằm trong scope:**
- Không đổi lịch chạy của các job nghiệp vụ (`analyze`, `lottery-*`, `match-odds`, ...).
- Không viết webhook listener tự chế — dùng đúng GitHub Actions self-hosted runner theo lựa chọn
  của user.
- Không sửa nội dung sai lệch trong `deploy/windows/README.md` về lịch "02:00" (bug doc có sẵn từ
  trước, không liên quan tới task này) — chỉ cập nhật đúng phần liên quan tới auto-update mà task
  này đổi.

## Subtasks

| # | Subtask | Mô tả | File chính |
|---|---|---|---|
| 01 | Add deploy workflow | Tạo `.github/workflows/deploy-selfhosted.yml`: trigger `push` vào `main` + `workflow_dispatch`, `runs-on: [self-hosted, Windows]`, 1 step gọi `auto-update.ps1` bằng đường dẫn tuyệt đối `C:\bots\auto-signal-bot\deploy\windows\auto-update.ps1`, không có step checkout | `.github/workflows/deploy-selfhosted.yml` (mới) |
| 02 | ~~Adjust fallback poll interval~~ | **SUPERSEDED bởi subtask 04** — ban đầu hạ interval 15→240 phút để giữ làm fallback. User xác nhận runner self-hosted đã chạy ổn (push tự pull thật trên GitHub), quyết định bỏ hẳn fallback poll thay vì giữ ở tần suất thấp. Đã áp dụng lúc viết (240 phút), nay bị 04 ghi đè. | `deploy/windows/register-tasks.ps1`, `deploy/windows/README.md` |
| 03 | Install runner on mini PC | Runbook (không phải code) — các lệnh cụ thể để cài GitHub Actions self-hosted runner làm Windows service trên mini PC, đăng ký vào repo `leesanhoon/auto-signal-bot`. User tự chạy trực tiếp trên mini PC (không qua Worker chat). **Đã hoàn tất** — user xác nhận runner đang chạy và push đã tự pull được. | Không sửa file trong repo — chỉ thao tác trên máy mini PC |
| 04 | Remove poll schedule | Xoá hẳn block đăng ký task Task Scheduler `auto-update` khỏi `register-tasks.ps1` (không còn fallback poll — runner self-hosted là đường duy nhất). Giữ nguyên `auto-update.ps1` (script vẫn được workflow `deploy-selfhosted.yml` gọi trực tiếp). Cập nhật README bỏ phần "lớp fallback". Thêm ghi chú cho user tự gỡ task `auto-update` đã đăng ký trước đó trên mini PC (nếu có) bằng 1 lệnh `Unregister-ScheduledTask` cụ thể — không chạy `unregister-tasks.ps1` toàn bộ vì sẽ gỡ luôn các job nghiệp vụ khác. | `deploy/windows/register-tasks.ps1`, `deploy/windows/README.md` |

## Acceptance criteria (Lead review sẽ check)

- `.github/workflows/deploy-selfhosted.yml` hợp lệ YAML, `runs-on: [self-hosted, Windows]`,
  trigger đúng `push: branches: [main]` + `workflow_dispatch`, KHÔNG có step `actions/checkout`.
- Step chạy `auto-update.ps1` dùng đường dẫn tuyệt đối cố định `C:\bots\auto-signal-bot\...`
  (không phụ thuộc `${{ github.workspace }}` vì cố tình không checkout).
- `register-tasks.ps1`: interval của task `auto-update` là 240 phút, không phải 15 phút; các task
  nghiệp vụ khác (`analyze-volman-*`, `lottery-*`, `fetch-matches-list`, `match-odds`) **không đổi**.
- `deploy/windows/README.md` phần auto-update mô tả đúng 2 lớp (push tức thời qua Actions runner +
  poll 4 giờ fallback), không còn câu sai "02:00 mỗi đêm".
- `git diff` chỉ động tới 3 file trên, không đụng job schedule nào khác, không đổi
  `auto-update.ps1`/`update.ps1`/`run-job.ps1`.
- Subtask 03 không tạo diff trong git — chỉ là tài liệu hướng dẫn, verify bằng cách đọc lại
  runbook có đủ bước: tải runner, `config.cmd` non-interactive với token lấy qua `gh api`,
  cài làm service (`svc install` + `svc start`), test bằng push thử.
