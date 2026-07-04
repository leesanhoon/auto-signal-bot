# Auto Signal Bot — Multi-Agent Task Queue Protocol

Project này dùng **file-based task queue** để phối hợp giữa `leader` và `worker` sub-agents trong Claude Code Desktop.

## Directory Structure

```
tasks/
├── <task-id>/                    # kebab-case, vd. "fix-parlay-parser"
│   ├── plan.md                   # [leader] Kiến trúc + phân rã subtask
│   ├── context.md                # [leader] Shared context (optional)
│   ├── 01-<subtask-id>/          # Subtask giao cho worker
│   │   ├── task.md               # [leader] Task cụ thể, self-contained
│   │   ├── result.md             # [worker] Kết quả thực thi
│   │   ├── review.md             # [leader] Review kết quả
│   │   ├── done.md               # [leader] Approval cuối
│   │   └── blocked.md            # [worker] Bị chặn
│   ├── 02-<subtask-id>/
│   │   └── ...
```

## Workflow

```
leader                                    worker
  │
  ├── Writes plan.md
  ├── Breaks into subtasks
  ├── Creates 01-*/task.md, 02-*/task.md
  │
  │                                    ┌── worker đọc task.md
  │                                    │   thực thi chính xác
  │                                    ├── viết result.md
  │
  ├── Đọc result.md ◄─────────────────┘
  ├── Viết review.md (APPROVED / CHANGES_REQUIRED)
  │
  │                                    ┌── worker sửa issues
  │                                    ├── update result.md
  │
  ├── Nếu OK → viết done.md
  └── Done!
```

## Sub-agents

Configured in `.claude/agents/`:

| Agent     | Model                  | Role                                                   |
| --------- | ---------------------- | ------------------------------------------------------ |
| `@leader` | sonnet (medium effort) | Planner: tạo plan.md + task.md, review result.md       |
| `@worker` | haiku (low effort)     | Executor: thực thi task.md chính xác, không deviations |

**Cách dùng:**

- `@leader plan the next feature` — leader lập plan + tạo subtask files
- `@worker run task tasks/<id>/01-*/task.md` — worker thực thi subtask
- `@leader review tasks/<id>/01-*/` — leader review kết quả worker

## Rules

1. **leader: mỗi plan phải có `## Subtasks` table + `task.md` cho mỗi subtask** (trừ khi user yêu cầu single-task plan)
2. **Chỉ sửa files được task chỉ định**
3. **worker: không bao giờ modify `done.md`** — chỉ leader viết
4. **worker: nếu không chắc → viết `blocked.md`, không đoán**
5. **leader: review code theo plan.md + task.md, không chỉ "chạy được là OK"**
6. **leader: không tự spawn subagent — chỉ tạo task files; user assign worker riêng**
7. **worker: trong fix loop, chỉ sửa đúng issues trong review.md, không thêm gì khác**

## Key Commands

```bash
npm run build            # TypeScript compile check
npm run test             # Chạy toàn bộ test suite
```

## Code Standards

- TypeScript, strict mode
- Prefer arrow functions over function declarations for callbacks
- Error handling: return Error objects, not throw (catch at top level)
- Tests: Vitest, in `tests/` mirroring `src/` structure
