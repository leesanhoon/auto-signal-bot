# Task: Formatter Label and Diff Check Cleanup

## Objective
Fix the currently failing betting formatter test and remove trailing whitespace that makes `git diff --check` fail.

## Shared Context
Read `tasks/continue-single-pass-ai-analysis/context.md` before editing.

## Instructions
1. Inspect `src/betting/odds-text-format.ts` around `formatMatchAnalysisMessage()` and `verifyLabel`.
2. Preserve explicit verify/revise status semantics:
   - `confirmed` -> `✅ *Thẩm định:* đạt`
   - `revised` -> `🔄 *Thẩm định:* đã hiệu chỉnh`
   - `failed` -> existing warning label is acceptable
   - `skipped` or missing status -> `🤖 *Chế độ:* AI phân tích trực tiếp`
3. Update `tests/betting/odds-text-format.test.ts` only if needed to match the intended semantics above. Do not weaken assertions unrelated to the failing behavior.
4. Remove trailing whitespace from `AGENTS.md` lines flagged by `git diff --check` without changing protocol content.
5. Do not touch `.env.example` or other betting/chart runtime files.

## Acceptance Criteria
- [ ] `npm run test -- tests/betting/odds-text-format.test.ts` passes.
- [ ] `git diff --check` no longer reports `AGENTS.md` trailing whitespace.
- [ ] `revised` analysis still displays the revised/thẩm định label, while skipped/unset displays direct AI mode.

## Files to Touch
- `src/betting/odds-text-format.ts` — fix `verifyLabel` branch for `revised`.
- `tests/betting/odds-text-format.test.ts` — adjust only if necessary.
- `AGENTS.md` — whitespace-only cleanup.

## Out of Scope
- Do not change env defaults.
- Do not change direct pick parsing.
- Do not commit.

## Verification Commands
```bash
npm run test -- tests/betting/odds-text-format.test.ts
git diff --check
```

## Result
Write `tasks/continue-single-pass-ai-analysis/01-formatter-diffcheck/result.md` with changes made and command output summary.
