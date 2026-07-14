# Auto Signal Bot — Claude Desktop / Codex Desktop Lead/Worker Workflow

## Mục tiêu

Dự án này dùng **manual desktop orchestration** theo mô hình:

- **Claude Desktop flow**
  - **Leader**: **Sonnet 5** — phân tích, viết `plan.md`, break thành subtask, review kết quả
  - **Worker**: **Haiku** — đọc `task.md`, thực thi chính xác, ghi `result.md`, fix theo `review.md`
- **Codex Desktop flow**
  - **Leader**: **GPT-5.4** với `model_reasoning_effort = medium` — tương đương ý định “5.4 medium”
  - **Worker**: **GPT-5.4-mini** với `model_reasoning_effort = low`

> Nếu đang dùng Claude Code Desktop Pro và **không có `/agents` / `@worker`**, hãy dùng **new chat cho từng phase**. Đây là workflow mặc định.
>
> Nếu đang dùng **Codex Desktop**, cũng áp dụng đúng nguyên tắc: **new chat cho từng phase**, chỉ đổi model theo vai trò.

## Runtime Rules

1. **Plan-first**: Leader phải viết `plan.md` trước khi implement.
2. **Mỗi plan phải có `## Subtasks` table** nếu task không quá nhỏ.
3. **Worker không được deviation**: không thêm feature, không refactor ngoài scope.
4. **Lead không approve chỉ vì build pass** — phải review đúng với `plan.md` + `task.md`.
5. **Nếu Worker bị chặn** → ghi `blocked.md`, không đoán.
6. **Không auto-commit / auto-push**.

## Directory Structure

```text
tasks/<task-id>/
├── plan.md                    # [Lead] architecture + breakdown
├── context.md                 # [Lead] shared context (optional)
├── review.md                  # [Lead] final review tổng hợp
├── done.md                    # [Lead] final approval
├── 01-<subtask>/
│   ├── task.md                # [Lead] executable instructions
│   ├── result.md              # [Worker] execution result + evidence
│   └── blocked.md             # [Worker] blocker report
└── 02-<subtask>/

reviews/<task-id>/
├── review-01-<subtask>.md     # [Lead] issue list cho từng subtask
└── review-summary.md          # [Lead] tổng hợp issues
```

## Manual Workflow

> Flow bên dưới áp dụng cho cả Claude Desktop và Codex Desktop. Chỉ thay model theo runtime đang dùng.

### Phase 1 — Lead / Sonnet 5

New chat trong Claude Desktop:

```text
Acting as Lead.
Phân tích yêu cầu, scan codebase cần thiết, rồi tạo:
- tasks/<task-id>/plan.md
- tasks/<task-id>/01-*/task.md, 02-*/task.md...

Yêu cầu:
- plan phải có ## Subtasks table
- task.md phải self-contained để Worker chạy không cần hỏi lại
```

### Phase 2 — Worker / Haiku

New chat khác trong Claude Desktop, chuyển model sang **Haiku**:

```text
Acting as Worker.
Đọc tasks/<task-id>/01-<subtask>/task.md
Thực thi chính xác theo task
Ghi kết quả vào tasks/<task-id>/01-<subtask>/result.md
Nếu bị chặn thì ghi blocked.md
Không deviation, không thêm feature
```

### Phase 3 — Lead Review / Sonnet 5

New chat khác, quay lại **Sonnet 5**:

```text
Acting as Lead reviewer.
Đọc plan.md + task.md + result.md + code thực tế.
Nếu đạt: ghi done.md hoặc approve subtask.
Nếu chưa đạt: ghi review.md hoặc reviews/<task-id>/review-01-<subtask>.md
Yêu cầu ghi rõ file path, line reference, và action cần fix.
```

### Phase 4 — Fix Loop / Haiku

New chat khác, model **Haiku**:

```text
Acting as Worker.
Đọc review.md hoặc reviews/<task-id>/review-01-<subtask>.md
Chỉ fix đúng các issue được liệt kê
Cập nhật result.md với evidence verify mới
```

## Codex Desktop Mapping

### Role mapping

| Runtime        | Lead                                        | Worker                                        |
| -------------- | ------------------------------------------- | --------------------------------------------- |
| Claude Desktop | Sonnet 5                                    | Haiku                                         |
| Codex Desktop  | `gpt-5.4` + `model_reasoning_effort=medium` | `gpt-5.4-mini` + `model_reasoning_effort=low` |

### Codex Desktop usage

1. **Lead chat**: mở Codex Desktop bằng shortcut Lead, tạo `plan.md` + `task.md`.
2. **Worker chat**: mở chat mới bằng shortcut Worker, thực thi `task.md` và ghi `result.md`.
3. **Lead review chat**: quay lại Lead để review against plan + code + result.
4. **Worker fix chat**: nếu có `review.md`, mở chat Worker mới để fix đúng issue.

### Codex launch shortcuts

```bash
codex-lead-app
codex-worker-app
```

### Important note for current Codex auth

- Với ChatGPT-auth hiện tại, string model `gpt-5.4-medium` **không được support**.
- Cấu hình tương đương thực tế đã verify là:
  - **Lead**: `gpt-5.4` + `model_reasoning_effort=medium`
  - **Worker**: `gpt-5.4-mini` + `model_reasoning_effort=low`

## Nếu muốn dùng Hermes làm Worker fallback

```bash
hermes --profile worker chat -q "
  Đọc tasks/<task-id>/01-<subtask>/task.md
  Thực thi chính xác theo task
  Ghi kết quả vào tasks/<task-id>/01-<subtask>/result.md
  Nếu blocked → ghi blocked.md
"
```

## Verification Commands

```bash
npm run build
npm run test
```

## Code Standards

- TypeScript strict mode
- Prefer arrow functions
- Error handling: return Error objects where project convention expects it
- Test files mirror `src/` structure under `tests/`

## Model Policy cho Superpowers Subagent Dispatch

Khi dispatch bất kỳ subagent nào qua các skill của Superpowers
(subagent-driven-development, executing-plans, hoặc bất kỳ skill nào dùng Task tool),
LUÔN áp dụng quy tắc sau — không được bỏ trống field `model`:

### Bắt buộc chỉ định model tường minh

- KHÔNG được để field `model` trống trong lời gọi Task tool.
- KHÔNG được để subagent tự động kế thừa model của session cha.

### Phân cấp model theo loại việc

- **Implementer (viết code theo task cụ thể, 1-2 file, cơ học rõ ràng):**
  dùng `claude-haiku-4-5`
- **Implementer cho task multi-file / cần hiểu context rộng hơn:**
  dùng `claude-haiku-4-5`
- **Task reviewer (spec compliance + code quality review):**
  dùng `claude-sonnet-5` — không hạ xuống Haiku, review cần đủ khả năng bắt lỗi
- **Architecture / design / brainstorming / writing-plans:**
  giữ nguyên model của Lead (Sonnet) — không delegate xuống subagent rẻ

### Ghi log để audit

Mỗi khi dispatch xong 1 task, ghi thêm model đã dùng vào dòng ledger
(`.superpowers/sdd/progress.md` hoặc file progress tương đương), định dạng:

Task N: complete (model: haiku, commits <base7>..<head7>, review clean)

### Khi nghi ngờ

Nếu không chắc task đủ đơn giản cho Haiku, mặc định dùng Sonnet trước —
báo lại cho tôi biết lý do hạ/nâng cấp model nếu có escalation từ subagent
(status BLOCKED hoặc NEEDS_CONTEXT).
