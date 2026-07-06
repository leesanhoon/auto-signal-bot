# Multi-Agent Task Queue Protocol

Project này dùng **file-based task queue** để phối hợp giữa:
- **Lead**: Claude Code Desktop (Sonnet 5 Medium) — lên plan, review code, quyết định final
- **Worker**: Hermes Agent (Worker profile) — thực thi task chi tiết

## Directory Structure

```
tasks/
├── <task-id>/                    # kebab-case, vd. "add-auth-middleware"
│   ├── plan.md                   # [Lead] Kiến trúc + phân rã subtask
│   ├── context.md                # [Lead] Shared background / references (optional)
│   ├── review.md                 # [Lead] Final review sau khi tất cả subtask xong
│   ├── done.md                   # [Lead] Final approval — viết khi OK hết
│   ├── 01-<subtask-id>/          # Subtask giao cho worker
│   │   ├── task.md               # [Lead] Task cụ thể, self-contained
│   │   ├── result.md             # [Worker] Kết quả thực thi
│   │   └── blocked.md            # [Worker] Bị chặn — cần clarification
│   └── 02-<subtask-id>/
│       └── ...
reviews/
├── <task-id>/                    # Review output khi có ISSUES
│   ├── review-01-<subtask>.md    # Review từng subtask
│   └── review-summary.md         # Tổng hợp issues cần fix
```

## Workflow

```
Claude Code Desktop (Lead — Sonnet 5 Medium)       Hermes Worker profile
  │                                                    
  ├── Viết plan.md + task.md                          
  ├── Gọi Worker: hermes --profile worker             
  │                                                     
  │                                           ┌──── Worker đọc task.md
  │                                           │     thực thi chính xác
  │                                           ├──── Viết result.md
  │                                           │
  ├── Đọc result.md ◄─────────────────────────┘
  ├── Review against plan.md + task.md
  │
  ├── Nếu ISSUES:
  │     Viết review.md (trong tasks/<id>/review.md HOẶC reviews/<id>/review-summary.md)
  │     → Gọi Worker fix → quay lại đọc result.md
  │
  ├── Nếu OK:
  │     Viết done.md
  └── Done!
```

## Roles

| Role | Tool | Model | Effort | Behavior |
|------|------|-------|--------|----------|
| **Lead** | Claude Code Desktop | Sonnet 5 (medium) | high | Lên plan architecture, viết task.md, review result.md, quyết định APPROVED/CHANGES_REQUIRED, ghi done.md |
| **Worker** | Hermes Agent (--profile worker) | Sonnet 4.5 Haiku (thấp) | low | Đọc task.md → thực thi chính xác → ghi result.md. Không deviation, không extras |

## Launch Commands

```bash
# Terminal 1: Lead — Claude Code Desktop (mở từ GUI hoặc CLI)
# Không cần chạy lệnh — dùng Claude Code Desktop UI

# Khi cần gọi Worker từ Lead:
# Trong Claude Code, gõ lệnh terminal:
hermes --profile worker chat -q "Thực thi task tasks/<task-id>/01-<subtask>/task.md"

# Hoặc chạy Worker interactive:
# Terminal riêng:
hermes --profile worker
```

## Cách Gọi Worker từ Claude Code

Trong Claude Code Desktop, khi cần worker làm việc:

```bash
# 1. Gọi worker chạy 1 task cụ thể
hermes --profile worker chat -q "
  Đọc file tasks/<task-id>/01-<subtask>/task.md
  Thực thi chính xác theo task
  Ghi kết quả vào tasks/<task-id>/01-<subtask>/result.md
  Nếu bị chặn → ghi blocked.md
"

# 2. Gọi worker interactive (nếu task phức tạp, cần nhiều bước)
# Mở terminal riêng:
hermes --profile worker
# Trong worker session: đọc task.md và làm theo
```

## Rules

1. **Lead: mỗi plan phải có `## Subtasks` table + `task.md` cho mỗi subtask** (trừ single-task plan)
2. **Không sửa files ngoài task directory** trừ khi task chỉ định
3. **Worker: không bao giờ modify `done.md`** — chỉ Lead viết
4. **Worker: nếu không chắc → viết `blocked.md`, không đoán**
5. **Lead: review code theo plan.md + task.md — không chỉ "chạy được là OK"**
6. **Commit messages: Lead quyết định khi nào và commit gì**
7. **Nếu Lead phát hiện ISSUES sau review → ghi vào reviews/<task-id>/review-summary.md và quay lại gọi Worker fix**