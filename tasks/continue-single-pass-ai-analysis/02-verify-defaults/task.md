# Task: Verify Toggle Defaults

## Objective
Align chart and betting verify toggles with single-pass-by-default behavior.

## Shared Context
Read `tasks/continue-single-pass-ai-analysis/context.md` before editing.

## Instructions
1. In `src/betting/odds-runner.ts`, change `parseBooleanEnv()` so unset/empty `BETTING_AI_VERIFY_ENABLED` returns `false`, not `true`.
2. In `tests/betting/odds-runner.test.ts`, add or update coverage proving:
   - unset `BETTING_AI_VERIFY_ENABLED` skips verify/revise and marks `verificationStatus: "skipped"` when picks exist.
   - falsey values (`false`, `0`, `no`, `off`) disable verify if practical without over-expanding tests.
   - explicit `true` still exercises existing verify/revise tests.
   - env restoration deletes the key when original was `undefined`.
3. In `.env.example`, set both default examples to no-verify single-pass mode:
   - `CHART_AI_VERIFY_ENABLED=false`
   - `BETTING_AI_VERIFY_ENABLED=false`
4. In `src/charts/chart-config-env.ts`, keep `getConfiguredChartVerifyEnabled()` default false and add final newline if missing.
5. In `tests/charts/chart-config-env.test.ts`, add explicit true coverage if missing:
   - unset -> false
   - falsey -> false
   - `true` -> true

## Acceptance Criteria
- [ ] Betting verify is opt-in when env is unset.
- [ ] Chart verify remains opt-in when env is unset.
- [ ] `.env.example` documents false defaults for both toggles.
- [ ] Focused tests pass.

## Files to Touch
- `.env.example` — verify toggle defaults only.
- `src/betting/odds-runner.ts` — default false helper.
- `tests/betting/odds-runner.test.ts` — env toggle coverage.
- `src/charts/chart-config-env.ts` — final newline/keep helper.
- `tests/charts/chart-config-env.test.ts` — true/false/default coverage.

## Out of Scope
- Do not change betting parser or Telegram formatter labels.
- Do not alter `CHART_SIGNAL_CONFIDENCE_THRESHOLD` behavior.
- Do not commit.

## Verification Commands
```bash
npm run test -- tests/betting/odds-runner.test.ts tests/charts/chart-config-env.test.ts
npm run build
```

## Result
Write `tasks/continue-single-pass-ai-analysis/02-verify-defaults/result.md` with changes made and command output summary.
