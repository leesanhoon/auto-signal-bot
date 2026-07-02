# Plan: Fix Telegram Vietnamese Normalization Review Findings

## Architecture
- This is a focused corrective task on the existing Telegram Vietnamese normalization changes.
- Keep the current formatter/prompt architecture unchanged.
- Fix only the review findings: no-bet detection for `Đứng ngoài` and one Vietnamese typo in the OpenRouter revise prompt.

## Implementation
- `src/betting/odds-text-format.ts`
  - Update `isStandAside` regex in `formatMatchAnalysisMessage()` so it recognizes both unaccented `Dung ngoai` and accented `Đứng ngoài` as stand-aside/no-bet recommendations.
- `tests/betting/odds-text-format.test.ts`
  - Update the existing no-bet test fixture to use `recommendation: "Đứng ngoài"`.
  - Strengthen the assertion to verify the current recommendation header `KÈO ĐỀ XUẤT` is absent.
- `src/betting/betting-gemini.ts`
  - Fix typo `phân tich` → `phân tích` in `REVISE_PROMPT`.

## Data Flow & Interfaces
- `parseMatchAnalysisResponse()` may now return `recommendation: "Đứng ngoài."`.
- `formatMatchAnalysisMessage()` must classify that value as stand-aside and avoid rendering the `🎯 *KÈO ĐỀ XUẤT*` section when no picks exist.
- No public function signatures change.

## Edge Cases & Error Handling
- Preserve recognition of existing unaccented legacy text: `Dung ngoai`, `Dung lai`, `khong co keo`, `khong co edge`.
- Add recognition of accented Vietnamese: `Đứng ngoài`, `đứng ngoài`, `Đứng lại`, and existing `không có kèo/edge` variants.
- Do not alter Telegram send/retry behavior.

## Testing Strategy
- Run focused formatter tests:
  ```bash
  npm run test -- tests/betting/odds-text-format.test.ts
  ```
- Run full validation:
  ```bash
  npm run test
  npm run build
  ```

## Review Findings Being Addressed
1. `src/betting/odds-text-format.ts:330-388` currently fails to recognize `Đứng ngoài` as no-bet, so Telegram renders `🎯 *KÈO ĐỀ XUẤT*` for stand-aside output.
2. `src/betting/betting-gemini.ts:52` has typo `phân tich` instead of `phân tích`.
