# Task: Direct Pick Normalization

## Objective
Finalize betting AI direct pick parsing so AI recommendations are not unnecessarily rewritten or hidden.

## Shared Context
Read `tasks/continue-single-pass-ai-analysis/context.md` before editing.

## Instructions
1. Inspect `src/betting/betting-gemini.ts` around `parseDirectPicks()` and `normalizeAnalysisAfterHydration()`.
2. Ensure direct AI picks are accepted without `candidateId` when they include:
   - non-empty `market`
   - non-empty `selection`
   - finite positive `odds`
3. Keep candidateId/legacy resolution only as backward compatibility, not as a requirement for direct picks.
4. Do not reintroduce the old odds `> 1.80` threshold for direct AI picks.
5. Change recommendation normalization so it does not force `"Đứng ngoài."` solely because raw pick input existed but all picks were dropped. Use fallback `"Đứng ngoài."` only when recommendation is missing/empty and there are no valid picks.
6. Add/strengthen tests in `tests/betting/betting-gemini.test.ts` for:
   - direct pick without `candidateId` is retained.
   - direct pick below old threshold (e.g. `1.79`) is retained.
   - invalid pick is dropped but non-empty recommendation remains unchanged.

## Acceptance Criteria
- [ ] Direct AI picks no longer require candidate hydration.
- [ ] Recommendation text is preserved unless empty.
- [ ] Existing candidateId/legacy tests still pass.
- [ ] Focused betting Gemini tests pass.

## Files to Touch
- `src/betting/betting-gemini.ts` — direct pick parser and normalization semantics.
- `tests/betting/betting-gemini.test.ts` — coverage for direct pick/no-rewrite behavior.

## Out of Scope
- Do not change OpenRouter model constants.
- Do not change runtime verify toggle default.
- Do not change Telegram output formatting.
- Do not commit.

## Verification Commands
```bash
npm run test -- tests/betting/betting-gemini.test.ts
npm run build
```

## Result
Write `tasks/continue-single-pass-ai-analysis/03-direct-pick-normalization/result.md` with changes made and command output summary.
