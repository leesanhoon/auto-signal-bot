# Task: Chart Runtime Coverage and Provenance Review

## Objective
Confirm chart runtime behavior matches single-pass analysis and provenance requirements, adding focused tests or comments only where gaps exist.

## Shared Context
Read `tasks/continue-single-pass-ai-analysis/context.md` before editing.

## Instructions
1. Inspect `src/charts/analyzer.ts` and existing tests in `tests/charts/analyzer.test.ts`.
2. Confirm parser/analyzer no longer filters setups by confidence or D1/H4/M15 confluence before returning AI setups.
3. Confirm every setup returned by `analyzeAllCharts()` gets `sourceCharts` for the screenshots in its pair group.
4. Inspect `src/charts/index.ts` and confirm verify is gated by `getConfiguredChartVerifyEnabled()` while Telegram later receives all `result.setups`.
5. Add a short code comment in `src/charts/index.ts` only if helpful: no-verify mode keeps setups user-visible; auto-track still requires explicit verification.
6. Inspect `src/shared/telegram.ts` and `tests/shared/telegram.test.ts` to confirm Telegram sends all AI setups and prefers provenance over fuzzy screenshot matching.
7. Add tests only for uncovered critical behavior; avoid broad refactors.

## Acceptance Criteria
- [ ] Low-confidence AI setups are retained by analyzer and sent by Telegram tests.
- [ ] Provenance exact matching remains covered.
- [ ] Chart verify remains optional and does not block Telegram display when disabled.
- [ ] Focused chart/Telegram tests pass.

## Files to Touch
- `src/charts/analyzer.ts` — only if a genuine issue is found.
- `src/charts/index.ts` — optional clarifying comment/log only.
- `tests/charts/analyzer.test.ts` — focused coverage if missing.
- `tests/shared/telegram.test.ts` — focused coverage if missing.

## Out of Scope
- Do not change betting files.
- Do not change env defaults in `.env.example`.
- Do not add new dependencies.
- Do not commit.

## Verification Commands
```bash
npm run test -- tests/charts/analyzer.test.ts tests/shared/telegram.test.ts
npm run build
```

## Result
Write `tasks/continue-single-pass-ai-analysis/04-chart-runtime-coverage/result.md` with changes made and command output summary.
