# Hermes Multi-Agent Backup & Restore

Hướng dẫn backup toàn bộ setup (lead + worker profiles, AGENTS.md, task queue) để chuyển sang máy khác.

---

## 📤 Backup — Trên máy hiện tại

```bash
cd /path/to/project   # ví dụ: cd H:/LeeSanHoon/auto-signal-bot
python hermes-backup/backup-hermes.py
```

Kết quả: `hermes-backup/hermes-multiagent-full-<timestamp>.tar.gz`

**File này bao gồm:**
- ✅ Profile `lead` — config, skills, SOUL.md, .env (API key), memories, sessions
- ✅ Profile `worker` — tương tự
- ✅ `AGENTS.md` — giao thức task queue
- ✅ `tasks/` — cấu trúc thư mục + example tasks
- ✅ `.bash_aliases` — alias `lead`/`worker`

---

## 📥 Restore — Trên máy mới

### Bước 1: Copy file backup sang máy mới

Copy file `hermes-multiagent-full-<timestamp>.tar.gz` qua máy mới bằng USB / cloud / SCP.

### Bước 2: Cài Hermes (nếu chưa có)

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
# hoặc: pip install hermes-agent
```

Chạy `hermes setup` ít nhất 1 lần để tạo cấu trúc thư mục mặc định.

### Bước 3: Restore

```bash
cd /path/to/your/project
python restore-hermes.py /path/to/hermes-multiagent-full-<timestamp>.tar.gz
```

Script sẽ:
1. Import profile `lead` và `worker` vào Hermes
2. Copy `AGENTS.md` và `tasks/` vào project
3. Copy `.bash_aliases` vào `~/.bash_aliases`

### Bước 4: Kiểm tra

```bash
hermes profile list
# Phải thấy lead và worker trong danh sách

source ~/.bashrc                     # load alias
lead --version                       # test alias lead
worker --version                     # test alias worker

hermes --profile lead -s claude-code chat -q "What model are you?" --quiet
# Phải trả lời: Claude Sonnet 4

hermes --profile worker chat -q "What model are you?" --quiet
# Phải trả lời: DeepSeek V4 Flash
```

---

## ⚠️ Lưu ý quan trọng

### API Keys
- File `.env` trong mỗi profile **có chứa API key** OpenRouter
- Nếu key còn hạn → dùng được luôn
- Nếu key hết hoặc không muốn copy key → xoá key khỏi `.env` của từng profile sau restore, rồi set lại:
  ```bash
  # Set lại key cho từng profile
  echo "OPENROUTER_API_KEY=sk-or-..." >> ~/AppData/Local/hermes/profiles/lead/.env
  echo "OPENROUTER_API_KEY=sk-or-..." >> ~/AppData/Local/hermes/profiles/worker/.env
  ```

### PATH cho wrapper scripts
Trên máy mới, nếu muốn dùng lệnh `lead` và `worker` (Windows batch):
```bash
# Kiểm tra PATH đã có ~/.local/bin chưa
echo $PATH | grep ".local/bin"

# Nếu chưa:
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Nếu Hermes version khác
Nếu máy mới có Hermes version khác, khi import profile có thể báo config cũ. Chạy:
```bash
hermes config migrate
```

---

## 📦 Cấu trúc thư mục backup

```
hermes-backup/
├── backup-hermes.py           # Script backup (chạy 1 lệnh)
├── restore-hermes.py          # Script restore (chạy 1 lệnh)
├── lead.tar.gz                # Export của lead profile
├── worker.tar.gz              # Export của worker profile
├── hermes-multiagent-full-*.tar.gz  # Full backup (tạo bởi backup-hermes.py)
└── README.md                  # File này
```