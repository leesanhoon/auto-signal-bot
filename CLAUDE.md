# Auto Signal Bot — Multi-Agent Workflow

## Kiến trúc

Dự án này phối hợp **Claude Code Desktop (Lead/Sonnet 5 Medium)** + **Worker (bất kỳ: Codex Desktop, Hermes Worker, Claude Code Haiku)** qua file-based task queue, **chạy hoàn toàn bằng tay**.

```
┌─ Lead (Claude Code Desktop, Sonnet 5) ─────────────────────┐
│  Viết plan.md + task.md                                     │
│  Đọc result.md → so với plan → viết review.md / done.md     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (đọc/ghi file)
┌─ Worker (Codex / Hermes / Claude Code Haiku) ──────────────┐
│  Đọc task.md → thực thi chính xác → ghi result.md          │
│  (hoặc đọc review → fix → cập nhật result.md)              │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
tasks/<task-id>/
├── plan.md           # [Lead] Plan + subtask breakdown
├── context.md        # [Lead] Shared context (optional)
├── review.md         # [Lead] Final review (tổng hợp)
├── done.md           # [Lead] Final approval
├── 01-<subtask>/     # Subtask directory
│   ├── task.md       # [Lead] Task instructions
│   ├── result.md     # [Worker] Execution result
│   └── blocked.md    # [Worker] Blocked
└── 02-<subtask>/

reviews/<task-id>/
├── review-01-<subtask>.md     # [Lead] Review từng subtask
└── review-summary.md          # [Lead] Tổng hợp issues cần fix
```

## Workflow Chi Tiết (Manual)

### Bước 1: Lead — Plan + Task
Mở **Claude Code Desktop**, chat với nội dung như:
> "Tạo plan cho tính năng X. Viết `tasks/<name>/plan.md` và task cho worker tại `tasks/<name>/01-*/task.md`"

### Bước 2: Gọi Worker (chọn 1 trong 3 cách)

**Option A — Codex Desktop (khuyến nghị, rẻ nhất):**
```bash
# Trong terminal của Codex Desktop:
codex -p "
  Đọc file tasks/<task-id>/01-<subtask>/task.md
  Thực thi chính xác nội dung task
  Ghi kết quả vào tasks/<task-id>/01-<subtask>/result.md
  Nếu bị chặn → ghi blocked.md
"
```

**Option B — Hermes Desktop (profile worker):**
```bash
# Trong terminal bất kỳ:
hermes --profile worker chat -q "
  Đọc tasks/<task-id>/01-<subtask>/task.md
  Thực thi chính xác nội dung task
  Ghi kết quả vào tasks/<task-id>/01-<subtask>/result.md
  Nếu blocked → ghi blocked.md
"
```

**Option C — Claude Code Desktop (model Haiku):**
```
# Dùng sub-agent @worker:
@worker đọc và thực thi tasks/<task-id>/01-<subtask>/task.md

# Hoặc chat trực tiếp, copy nội dung task.md vào
```

### Bước 3: Lead — Review
Mở `result.md` trong Claude Code Desktop:
> "Review `tasks/<task-id>/01-<subtask>/result.md` so với `plan.md`"

- Nếu **OK**: viết `done.md` (hoặc đánh dấu subtask hoàn thành)
- Nếu **ISSUES**: viết `reviews/<task-id>/review-01-<subtask>.md` nêu rõ issues + line numbers

### Bước 4: Fix Loop
Gọi lại worker với review content:
```bash
# Codex:
codex -p "
  Đọc reviews/<task-id>/review-01-<subtask>.md
  Fix các issues được liệt kê
  Cập nhật tasks/<task-id>/01-<subtask>/result.md
"

# Hoặc Hermes:
hermes --profile worker chat -q "(nội dung tương tự)"
```

### Bước 5: Lead — Done
Khi tất cả subtask approved → viết `tasks/<task-id>/done.md`

---

## Chọn Worker nào?

| Worker | Chi phí | Cần cài đặt | Tool access | Ghi chú |
|--------|---------|-------------|-------------|---------|
| **Codex Desktop** (GPT-5.4-mini) | 🟢 Rẻ nhất (~$0.15/M) | ✅ Codex CLI | File + terminal | Khuyến nghị — rẻ, đủ mạnh |
| **Hermes Worker** | 🟡 Trung bình | ✅ Hermes + profile worker | File + terminal + browser + ... | Mạnh nhất, nhiều tool |
| **Claude Code Haiku** | 🟡 Trung bình (~$0.25/M) | ✅ Claude Code | File + terminal | Dễ vì cùng ecosystem |
| **Claude Code Sonnet (Lead)** | 🔴 Đắt (~$3/M) | ✅ Claude Code | File + terminal | Chỉ làm Lead, không làm Worker |

---

## Sub-agents (Claude Code Internal)

Chỉ dùng khi không có Codex/Hermes:

| Agent | Model | Effort | Role |
|-------|-------|--------|------|
| `@leader` | Sonnet 5 | medium | Planner: tạo plan + task, review code |
| `@worker` | Haiku | low | Executor: chạy task nhanh, không deviation |

## Key Commands

```bash
npm run build            # TypeScript compile check
npm run test             # Chạy toàn bộ test suite
npm run test -- --run    # Chạy test 1 lần (không watch)
```

## Code Standards

- TypeScript, strict mode
- Prefer arrow functions
- Error handling: return Error objects, không throw (catch ở top level)
- Tests: Vitest, trong `tests/` mirror `src/` structure