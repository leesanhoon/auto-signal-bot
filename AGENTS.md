# Multi-Agent Task Queue Protocol

Canonical protocol: **`CLAUDE.md`** (Claude Code Desktop auto-loads it).
File này là phiên bản tóm tắt có thêm Hermes-specific instructions.

## Directory Structure

```
tasks/
├── <task-id>/                    # kebab-case, vd. "add-auth-middleware"
│   ├── plan.md                   # [Lead] Kiến trúc + phân rã subtask
│   ├── context.md                # [Lead] Shared context (optional)
│   ├── 01-<subtask-id>/          # Subtask giao cho worker
│   │   ├── task.md               # [Lead] Task cụ thể, self-contained
│   │   ├── result.md             # [Worker] Kết quả thực thi
│   │   ├── review.md             # [Lead] Review kết quả
│   │   ├── done.md               # [Lead] Approval cuối cùng
│   │   └── blocked.md            # [Worker] Bị chặn
│   └── 02-<subtask-id>/
│       └── ...
```

## Roles

### Claude Code Desktop (`.claude/agents/`)

| Agent     | Model               | Role                                                   |
| --------- | ------------------- | ------------------------------------------------------ |
| `@leader` | sonnet (low effort) | Planner: tạo plan.md + task.md, review result.md       |
| `@worker` | haiku (low effort)  | Executor: thực thi task.md chính xác, không deviations |

### Hermes Profiles

| Profile    | Model                                     | max_turns | Behavior                                                                 |
| ---------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------ |
| **lead**   | `anthropic/claude-sonnet-5` (OpenRouter)  | 120       | Plans, breaks work into subtasks, reviews. **Không tự spawn subagents.** |
| **worker** | `anthropic/claude-haiku-4.5` (OpenRouter) | 40        | Executes assigned `task.md` literally.                                   |

## Workflow

```
Lead                                      Worker
  │
  ├── Writes plan.md
  ├── Breaks into subtasks
  ├── Creates 01-*/task.md, 02-*/task.md
  │
  │                                    ┌── Worker đọc task.md
  │                                    │   thực thi chính xác
  │                                    ├── viết result.md
  │
  ├── Đọc result.md ◄─────────────────┘
  ├── Viết review.md (APPROVED / CHANGES_REQUIRED)
  │
  │                                    ┌── Worker sửa issues
  │                                    ├── update result.md
  │
  ├── Nếu OK → viết done.md
  └── Done!
```

## Launch

### Claude Code Desktop

```bash
# Leader: lập plan + tạo subtask files
claude -p "@leader plan: <mô tả>" --allowedTools "Read,Write,Edit,Bash"

# Worker: thực thi subtask
claude -p "@worker execute tasks/<id>/01-*/task.md" --allowedTools "Read,Write,Edit,Bash"

# Hoặc dùng Claude Code Desktop GUI: mở project, gõ @leader / @worker
```

### Hermes Desktop

```bash
# Launch as Lead
hermes --profile lead

# Launch as Worker
hermes --profile worker
```

## Rules

1. **Lead:** mỗi plan phải có `## Subtasks` table + `task.md` cho mỗi subtask (trừ khi user yêu cầu single-task plan)
2. **Chỉ sửa files được task chỉ định**
3. **Worker:** không bao giờ modify `done.md` — chỉ Lead viết
4. **Worker:** nếu không chắc → viết `blocked.md`, không đoán
5. **Lead:** review code theo plan.md + task.md, không chỉ "chạy được là OK"
6. **Lead:** không tự spawn subagent — chỉ tạo task files; user assign worker riêng
7. **Worker:** trong fix loop, chỉ sửa đúng issues trong review.md, không thêm gì khác

## File Format

Xem `tasks/.examples/` cho các file mẫu hoặc `CLAUDE.md` cho protocol đầy đủ.
