# Fix Combined Follow-up Plan

## Mục tiêu
Hoàn thiện nhánh combined match analysis sau review:
1. Fix `generateCombinedAnalysis()` đang ghi AI usage/log bằng token giả `0`.
2. Hoàn thiện task 04 (`odds-runner.ts`) bằng các guard chống thiếu field từ AI output.
3. Lập kế hoạch dọn các file `.md` task/plan không cần giữ trong repo.

## Quyết định đã xác nhận với user
- **Giữ web plugin cho Combined AI**: không remove `plugins: [{ id: "web", ... }]` trong combined request.
- **Prompt newline đã được user chỉnh**: đã kiểm tra hiện tại `betting-gemini.ts` dùng `join("\n")`, không còn literal `\\n`.

## Trạng thái xác minh hiện tại
- `npx tsc --noEmit` — PASS
- `npm test -- tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts` — PASS, 8 tests
- `grep -n 'join(.*\\\\n' src/betting/betting-gemini.ts` — không còn literal `\\n`; các join hiện là `"\n"`

## Subtasks

| ID | Owner | Parallelizable | Dependencies | Allowed files | Expected output |
|----|-------|----------------|--------------|---------------|-----------------|
| 01-ai-usage-log | worker | yes | none | `src/betting/betting-gemini.ts`, `tests/betting/betting-gemini.test.ts` | `tasks/fix-combined-followup/01-ai-usage-log/result.md` |
| 02-review-task04-fixes | worker | yes | none | `src/betting/odds-runner.ts`, `tests/betting/odds-runner.test.ts` | `tasks/fix-combined-followup/02-review-task04-fixes/result.md` |
| 03-md-cleanup-plan | worker | yes | none | markdown inventory only; do not delete yet | `tasks/fix-combined-followup/03-md-cleanup-plan/result.md` |

Parallelizable: yes. These three can run independently.

---

## Architecture decisions

### AI usage/log fix
Current bad behavior in `src/betting/betting-gemini.ts`:
- `generateCombinedAnalysis()` logs/records in `finally` using a fabricated response:
  ```ts
  { text: "", usage: { promptTokens: 0, completionTokens: 0 } }
  ```
- This corrupts usage/cost tracking.

Correct approach:
- Log and record usage immediately after each real OpenRouter response.
- Use actual `response.usage.promptTokens`, `response.usage.completionTokens`, `response.finishReason`.
- Do not record usage if all requests fail before OpenRouter returns a response.

### Task 04 robustness fix
Current risky code in `src/betting/odds-runner.ts`:
```ts
keyPoints: Array.from(match.keyPoints).slice(0, 2),
risks: Array.from(match.risks).slice(0, 2),
```
If AI omits these arrays, runtime throws.

Correct approach:
```ts
const topPicks = Array.isArray(match.topPicks) ? match.topPicks : [];
const keyPoints = Array.isArray(match.keyPoints) ? match.keyPoints.slice(0, 2) : [];
const risks = Array.isArray(match.risks) ? match.risks.slice(0, 2) : [];
```

### Markdown cleanup policy
Do not delete project documentation. Candidate deletion is limited to ephemeral planning/task artifacts after review/merge.

Keep:
- `README.md`
- `AGENTS.md`
- `CODEX-TASK.md` unless user says obsolete
- `docs/**/*.md`
- `plans/**/*.md` unless explicitly superseded
- `tasks/README.md`

Candidate delete/archive after active work is complete:
- completed task directories under `tasks/*` with `done.md`
- transient generated task directories under `tasks/combined-match-analysis/` and `tasks/fix-combined-followup/` after final approval

## Verification strategy
Run after fixes:
```bash
cd H:/LeeSanHoon/auto-signal-bot
npx tsc --noEmit
npm test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts
npm test -- --run
```

## Approval criteria
- `generateCombinedAnalysis()` records real token usage on primary success.
- `generateCombinedAnalysis()` records real token usage on fallback success.
- `generateCombinedAnalysis()` does not record fake zero usage when both primary and fallback fail.
- `odds-runner.ts` handles missing `keyPoints`, `risks`, and `topPicks` defensively.
- Markdown cleanup is only planned, not executed, unless user explicitly approves deletion.
