# Task: Final Validation Review

## Objective
Run final validation after implementation subtasks finish and report whether the working tree is ready for Lead review/commit.

## Shared Context
Read `tasks/continue-single-pass-ai-analysis/context.md`, `tasks/continue-single-pass-ai-analysis/plan.md`, and result files from subtasks 01-04 before starting.

## Instructions
1. Do not modify source files unless the Lead explicitly reassigns a fix. This task is review/read-only except writing this subtask's `result.md`.
2. Run final validation commands:
   ```bash
   npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts tests/charts/analyzer.test.ts tests/charts/chart-config-env.test.ts tests/shared/telegram.test.ts
   npm run test
   npm run build
   git diff --check
   ```
3. Inspect `git diff --stat` and `git diff --name-status` to summarize final changed files.
4. If any command fails, record exact failure and likely owning subtask/file.
5. If all pass, state `READY_FOR_LEAD_REVIEW`.

## Acceptance Criteria
- [ ] Focused tests pass.
- [ ] Full test suite passes.
- [ ] Build passes.
- [ ] `git diff --check` passes.
- [ ] Result contains a concise changed-file summary and any remaining risks.

## Files to Touch
- `tasks/continue-single-pass-ai-analysis/05-final-validation-review/result.md` only.

## Out of Scope
- Do not fix code in this task.
- Do not commit, push, or stash.

## Verification Commands
Same as instructions above.

## Result
Write `tasks/continue-single-pass-ai-analysis/05-final-validation-review/result.md` with command output summary and verdict.
