# Deploy trên Mini PC (Windows Server 2019) bằng Docker

Thay thế toàn bộ lịch chạy của GitHub Actions bằng Docker + [Ofelia](https://github.com/mcuadros/ofelia) chạy trên mini PC.

## Kiến trúc

```
Windows Server 2019 (mini PC)
└── Hyper-V VM: Ubuntu Server 24.04
    └── Docker Engine + Compose
        ├── bot        — container thường trực (code + node_modules + Chromium)
        └── scheduler  — Ofelia, exec từng job vào "bot" đúng lịch cron (UTC)
```

**Vì sao cần VM?** Windows Server 2019 không hỗ trợ Docker Desktop lẫn WSL2, nên không chạy trực tiếp Linux container được. Giải pháp chuẩn là một VM Ubuntu trên Hyper-V (có sẵn trong Windows Server).

## Bước 1 — Tạo VM Ubuntu trên Hyper-V

1. Bật Hyper-V (PowerShell admin, khởi động lại sau khi chạy):

   ```powershell
   Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
   ```

2. Tải ISO [Ubuntu Server 24.04 LTS](https://ubuntu.com/download/server).
3. Hyper-V Manager → New → Virtual Machine:
   - **Generation 2**, RAM **4 GB** (tối thiểu 2 GB), đĩa **40 GB**
   - Network: gắn vào **External Switch** (tạo qua Virtual Switch Manager nếu chưa có) để VM ra được internet
   - Security: tắt **Secure Boot** hoặc chọn template *Microsoft UEFI Certificate Authority*
4. Cài Ubuntu (chọn cài luôn OpenSSH server). Sau khi cài xong, SSH vào VM từ Windows để thao tác cho tiện.
5. Đặt VM tự khởi động cùng host: VM Settings → **Automatic Start Action** → *Always start*.

## Bước 2 — Cài Docker trong VM

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# logout/login lại để nhóm docker có hiệu lực
```

## Bước 3 — Deploy bot

```bash
git clone https://github.com/<owner>/auto-signal-bot.git
cd auto-signal-bot

# Tạo file secrets từ mẫu, điền giá trị thật
# (lấy từ GitHub → Settings → Secrets and variables → Actions)
cp .env.example .env
nano .env

# Build và chạy
docker compose up -d --build
```

Kiểm tra:

```bash
docker compose ps                    # cả "bot" và "scheduler" phải Up
docker compose logs -f scheduler     # Ofelia in ra danh sách job đã đăng ký
```

Chạy thử một job ngay lập tức (không chờ lịch):

```bash
docker compose exec bot npm run analyze:smc
```

## Bước 4 — Cập nhật code

Khi có commit mới trên `main`:

```bash
./deploy/update.sh
```

(script làm: `git pull` → rebuild image → restart container)

## Lịch chạy

Toàn bộ lịch định nghĩa trong labels của service `bot` trong [docker-compose.yml](../docker-compose.yml), giữ nguyên **UTC** như GitHub Actions. Lưu ý Ofelia dùng cron **6 trường** (thêm giây ở đầu) — ví dụ `"0 */15 * * * 1-5"` = mỗi 15 phút, thứ 2–6.

| Job | Lịch (UTC) | Giờ VN |
|---|---|---|
| analyze (Volman) | 00:05, 04:05 … 20:05 T2–T6 | 07:05, 11:05 … |
| analyze:smc | mỗi 15 phút T2–T6 | — |
| fetch-matches-list | 00:00 hằng ngày | 07:00 |
| match-odds | 05:00 hằng ngày | 12:00 |
| performance-report | T2 01:15 (weekly), ngày 1 01:20 (monthly) | 08:15 / 08:20 |
| lottery | 12:00 hằng ngày | 19:00 |
| lottery-predict | 09:45 / 10:45 / 11:45 (MN/MT/MB) | 16:45 / 17:45 / 18:45 |
| lottery-verify | 09:45 / 10:45 / 11:50 (MN/MT/MB) | 16:45 / 17:45 / 18:50 |

## Xem log

```bash
docker compose logs -f scheduler   # lịch sử chạy job, exit code
docker logs <container>            # Ofelia log output từng lần exec vào log của chính nó
```

Kết quả nghiệp vụ (tín hiệu, báo cáo) vẫn về Telegram + Supabase như trước.

## Tắt lịch trên GitHub Actions

Khi mini PC đã chạy, xoá block `schedule:` trong các file `.github/workflows/*.yml` (giữ `workflow_dispatch:` để còn chạy tay làm phương án dự phòng khi mini PC bảo trì).

Lưu ý nếu muốn chạy song song vài ngày để so sánh: có dedup qua Supabase (`open_positions`, upsert lottery) nên phần lớn trường hợp không sinh tín hiệu đôi, nhưng hai run trùng thời điểm vẫn có thể race và gửi Telegram trùng. Nếu chấp nhận được vài tin nhắn trùng thì chạy song song; không thì tắt schedule trên GitHub ngay khi bật mini PC.
