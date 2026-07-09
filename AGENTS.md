# Multi-Agent Task Queue Protocol

Project này dùng **file-based task queue** với workflow chính là **manual desktop orchestration**:

- **Claude Desktop mode**
  - **Lead**: Sonnet 5 — lên plan, break subtask, review, quyết định final
  - **Worker**: Haiku — thực thi task literal, report lại cho Lead
- **Codex Desktop mode**
  - **Lead**: `gpt-5.4` + reasoning `medium`
  - **Worker**: `gpt-5.4-mini` + reasoning `low`
- **Hermes Worker profile**: chỉ là **fallback** khi cần chạy Worker ngoài Claude Desktop / Codex Desktop

## Directory Structure

```text
tasks/
├── <task-id>/
│   ├── plan.md
│   ├── context.md                # optional
│   ├── review.md
│   ├── done.md
│   ├── 01-<subtask-id>/
│   │   ├── task.md
│   │   ├── result.md
│   │   └── blocked.md
│   └── 02-<subtask-id>/
│       └── ...
reviews/
├── <task-id>/
│   ├── review-01-<subtask>.md
│   └── review-summary.md
```

## Workflow

```text
Lead Desktop (Sonnet 5 / GPT-5.4)          Worker Desktop (Haiku / GPT-5.4-mini)
  │                                                │
  ├── Viết plan.md + task.md                       │
  ├── Break task thành các subtask độc lập         │
  │                                                ├── Đọc task.md
  │                                                ├── Thực thi chính xác
  │                                                ├── Ghi result.md
  │                                                └── Nếu blocked → ghi blocked.md
  │
  ├── Đọc result.md + code thực tế  ◄──────────────┘
  ├── Review against plan.md + task.md
  │
  ├── Nếu có issue:
  │     ghi review.md hoặc reviews/<task-id>/review-*.md
  │     rồi Worker fix đúng issue được nêu
  │
  └── Nếu đạt:
        ghi done.md
```

## Runtime Rules

1. **Lead luôn plan-first** — không implement ngay nếu chưa có plan.
2. **Mỗi plan phải có `## Subtasks` table** trừ task rất nhỏ.
3. **Worker chỉ execute** — không thêm feature, không deviation, không refactor ngoài scope.
4. **Worker không bao giờ sửa `done.md`**.
5. **Nếu không chắc → ghi `blocked.md`, không đoán**.
6. **Lead review theo plan + task + code thật**, không chỉ dựa vào output.
7. **Không auto-commit / auto-push**.

## Claude Desktop Usage

- Nếu dùng Claude Code Desktop Pro và không có `/agents`, dùng **new chat cho từng phase**:
  - Chat 1: Lead / Sonnet 5 → plan + task
  - Chat 2: Worker / Haiku → execute + result
  - Chat 3: Lead / Sonnet 5 → review
  - Chat 4: Worker / Haiku → fix

## Codex Desktop Usage

- Dùng **new chat cho từng phase** giống Claude Desktop:
  - Chat 1: Lead / `gpt-5.4` + reasoning `medium` → plan + task
  - Chat 2: Worker / `gpt-5.4-mini` + reasoning `low` → execute + result
  - Chat 3: Lead / `gpt-5.4` + reasoning `medium` → review
  - Chat 4: Worker / `gpt-5.4-mini` + reasoning `low` → fix
- Shortcut launcher local:
  - `codex-lead-app`
  - `codex-worker-app`
- Lưu ý: với ChatGPT-auth hiện tại, `gpt-5.4-medium` không chạy được trong Codex. Mapping đã verify là `gpt-5.4` + effort `medium`.

## Hermes Fallback Command

```bash
hermes --profile worker chat -q "
  Đọc file tasks/<task-id>/01-<subtask>/task.md
  Thực thi chính xác theo task
  Ghi kết quả vào tasks/<task-id>/01-<subtask>/result.md
  Nếu blocked → ghi blocked.md
"
```