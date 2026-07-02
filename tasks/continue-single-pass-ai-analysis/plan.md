# Plan: Continue Single-Pass AI Analysis Changes

## Architecture

The current working tree is mid-implementation for a single-pass AI analysis flow across betting odds and chart analysis.

Key decisions:
- Keep OpenRouter verify/revise code available, but make runtime verify opt-in by env toggles.
- Let AI output be visible to Telegram without confidence/confluence filtering in parser/formatter layers.
- Keep deterministic parsing/formatting only for schema safety, not to rewrite the model's substantive recommendation.
- Preserve provenance metadata for chart screenshots so Telegram sends the chart that corresponds to the AI setup.
- Keep auto-tracking conservative: no auto-track unless verification explicitly confirmed a `MARKET_NOW` setup.

## Implementation

### File list and responsibilities

- `.env.example`
  - Document opt-in/opt-out defaults for chart and betting verify toggles.
- `AGENTS.md`
  - Keep protocol update if desired, but remove trailing whitespace so `git diff --check` passes.
- `src/betting/betting-gemini.ts`
  - Finalize direct AI pick parsing and normalization semantics.
- `src/betting/odds-runner.ts`
  - Make betting verify default false when `BETTING_AI_VERIFY_ENABLED` is unset.
- `src/betting/odds-text-format.ts`
  - Fix verification label semantics and formatting tests.
- `src/charts/chart-config-env.ts`
  - Keep chart verify default false and add final newline.
- `src/charts/index.ts`
  - Keep chart verify gated by `CHART_AI_VERIFY_ENABLED`; optionally clarify log/comment around no-verify behavior.
- `tests/betting/*`
  - Align tests with single-pass defaults and direct pick behavior.
- `tests/charts/*`
  - Cover chart verify toggle and setup/provenance behavior.
- `tests/shared/telegram.test.ts`
  - Keep provenance and low-confidence AI setup Telegram coverage.

### Data flow

1. Betting: fetch odds payload -> format raw/full odds JSON -> AI analyze -> parse direct picks -> optional verify/revise only if `BETTING_AI_VERIFY_ENABLED=true` -> Telegram formatting.
2. Charts: capture screenshots -> group by pair -> AI analyze each pair -> attach `sourceCharts` -> optional verify only if `CHART_AI_VERIFY_ENABLED=true` and setup meets threshold -> send all AI setups to Telegram with provenance-based chart selection.

### Interfaces/signatures

No new public module signatures are required beyond current changes:
- `isBettingVerifyEnabled(): boolean`
- `getConfiguredChartVerifyEnabled(): boolean`
- `formatFullOddsAnalysisInput(payload: MatchOddsPayload): string`
- `TradeSetup.sourceCharts?: ChartAnalysisSource[]`
- `TradeSetup.telegramChart?: ChartAnalysisSource`
- `MatchAiAnalysis.verificationStatus?: "confirmed" | "revised" | "failed" | "skipped"`

## Subtasks

Parallelizable: partial. Subtasks 01, 02, 03, and 04 touch separate code areas except `.env.example`; avoid parallel edits to `.env.example` by assigning it only to 02. Subtask 05 depends on all implementation subtasks.

| ID | Owner | Parallelizable | Dependencies | Allowed files | Output |
|----|-------|----------------|--------------|---------------|--------|
| 01-formatter-diffcheck | worker | yes | none | `src/betting/odds-text-format.ts`, `tests/betting/odds-text-format.test.ts`, `AGENTS.md` | `tasks/continue-single-pass-ai-analysis/01-formatter-diffcheck/result.md` |
| 02-verify-defaults | worker | yes | none | `.env.example`, `src/betting/odds-runner.ts`, `tests/betting/odds-runner.test.ts`, `src/charts/chart-config-env.ts`, `tests/charts/chart-config-env.test.ts` | `tasks/continue-single-pass-ai-analysis/02-verify-defaults/result.md` |
| 03-direct-pick-normalization | worker | yes | none | `src/betting/betting-gemini.ts`, `tests/betting/betting-gemini.test.ts` | `tasks/continue-single-pass-ai-analysis/03-direct-pick-normalization/result.md` |
| 04-chart-runtime-coverage | worker | yes | none | `src/charts/analyzer.ts`, `src/charts/index.ts`, `tests/charts/analyzer.test.ts`, `tests/shared/telegram.test.ts` | `tasks/continue-single-pass-ai-analysis/04-chart-runtime-coverage/result.md` |
| 05-final-validation-review | subagent | no | 01, 02, 03, 04 | read-only repo inspection; write only `tasks/continue-single-pass-ai-analysis/05-final-validation-review/result.md` | `tasks/continue-single-pass-ai-analysis/05-final-validation-review/result.md` |

For each subtask, Lead has created `tasks/continue-single-pass-ai-analysis/<subtask-id>/task.md`. Avoid assigning two workers to edit overlapping files.

## Testing Strategy

Focused commands by subtask:

```bash
npm run test -- tests/betting/odds-text-format.test.ts
git diff --check
npm run test -- tests/betting/odds-runner.test.ts tests/charts/chart-config-env.test.ts
npm run test -- tests/betting/betting-gemini.test.ts
npm run test -- tests/charts/analyzer.test.ts tests/shared/telegram.test.ts
```

Final validation:

```bash
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts tests/charts/analyzer.test.ts tests/charts/chart-config-env.test.ts tests/shared/telegram.test.ts
npm run test
npm run build
git diff --check
```

Expected final state:
- Focused tests pass.
- Full test suite passes.
- Build passes.
- `git diff --check` passes without trailing whitespace errors.

## Edge Cases & Error Handling

- If verify env is unset, both chart and betting should behave as single-pass no-verify by default.
- Explicit `true` must still run existing verify/revise paths and preserve `confirmed/revised/failed` labels.
- Explicit falsey values (`false`, `0`, `no`, `off`) should disable verify.
- AI direct picks without `candidateId` should remain visible if they include valid `market`, `selection`, and positive `odds`.
- Invalid direct picks should be dropped for schema safety, but the textual recommendation should not be rewritten solely because picks were dropped.
- Telegram chart matching should prefer exact provenance before fuzzy fallback.
- No worker should commit, push, or rewrite history unless the user asks.
