# Context: Continue Single-Pass AI Analysis Changes

Generated: 2026-07-02 22:35 +0700

## Current Git State Summary

Branch: `main`

Modified tracked files:
- `.env.example`
- `.gitignore`
- `AGENTS.md`
- `src/betting/betting-gemini.ts`
- `src/betting/betting-types.ts`
- `src/betting/odds-runner.ts`
- `src/betting/odds-text-format.ts`
- `src/charts/analyzer.ts`
- `src/charts/chart-config-env.ts`
- `src/charts/chart-types.ts`
- `src/charts/index.ts`
- `src/shared/telegram.ts`
- `tests/betting/betting-gemini.test.ts`
- `tests/betting/odds-runner.test.ts`
- `tests/betting/odds-text-format.test.ts`
- `tests/charts/analyzer.test.ts`
- `tests/shared/telegram.test.ts`

Untracked files:
- `.hermes/plans/2026-07-02_212746-simplify-ai-analysis-no-verify-raw-data.md`
- `.hermes/reviews/2026-07-02_205818-code-review-improve-analysis.md`
- `tasks/fix-telegram-vietnamese-review/plan.md`
- `tasks/fix-telegram-vietnamese-review/task.md`
- `tests/charts/chart-config-env.test.ts`

## User Intent Being Implemented

The active change set follows `.hermes/plans/2026-07-02_212746-simplify-ai-analysis-no-verify-raw-data.md`:
- Simplify chart and betting pipelines into single-pass AI analysis.
- Send fuller/rawer input to AI.
- Stop default verify/revise behavior unless explicitly enabled.
- Avoid deterministic filtering that hides AI output before Telegram.
- Preserve safety around auto-tracking positions: no verify means user-visible only; auto-track still requires `verifiedConfirmed === true` and `MARKET_NOW`.

## Verification Observed

Commands run:

```bash
git diff --check
```

Result: FAIL due to trailing whitespace in `AGENTS.md:38-41`.

```bash
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts tests/charts/analyzer.test.ts tests/charts/chart-config-env.test.ts tests/shared/telegram.test.ts
```

Result: FAIL, 37 passed / 1 failed.

Failure:
- `tests/betting/odds-text-format.test.ts > formatMatchAnalysisMessage > highlights the revised recommendation and limits supporting detail`
- Expected `🔄 *Thẩm định:* đã hiệu chỉnh`
- Actual message contains `🤖 *Chế độ:* AI phân tích trực tiếp`

```bash
npm run build
```

Result: PASS (`tsc` exit 0).

## Review Findings / Risks

1. `src/betting/odds-text-format.ts` changed `verificationStatus === "revised"` label to direct AI mode, but existing test expects revised label. Decide intended behavior: if verify is explicitly enabled and revision happened, keep `🔄 *Thẩm định:* đã hiệu chỉnh`; only skipped/unset should show direct AI mode.
2. `src/betting/odds-runner.ts:isBettingVerifyEnabled()` still defaults to `true` when env is unset (`if (!normalized) return true;`). The single-pass plan says betting verify should default false.
3. `.env.example` currently has `CHART_AI_VERIFY_ENABLED=true` but the single-pass plan says chart verify should default false.
4. `src/betting/betting-gemini.ts:normalizeAnalysisAfterHydration()` still forces `Đứng ngoài.` when raw pick input exists but parser drops all picks. The plan says do not rewrite AI recommendation just because direct picks fail to hydrate.
5. `src/betting/betting-gemini.ts:parseDirectPicks()` still builds and uses candidate pool fallback. This is acceptable for backward compatibility only if direct AI picks without candidateId are accepted first and no odds threshold is reintroduced.
6. `tests/betting/odds-runner.test.ts` lacks a default-unset betting verify test; explicit false test exists.
7. `src/charts/index.ts` gates verify on high-confidence setups only, which is okay for verify, but comments/logs should make clear Telegram sends all AI setups later via `sendAllAnalyses()`.
8. `src/charts/chart-config-env.ts` has no final newline.
9. `AGENTS.md` changes are documentation/protocol changes, not code behavior, but currently break `git diff --check` due trailing whitespace.

## Commands to Use for Final Validation

```bash
npm run test -- tests/betting/betting-gemini.test.ts tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts tests/charts/analyzer.test.ts tests/charts/chart-config-env.test.ts tests/shared/telegram.test.ts
npm run test
npm run build
git diff --check
```
