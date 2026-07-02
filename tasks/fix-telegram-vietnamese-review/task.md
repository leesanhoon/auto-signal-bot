# Task: Fix Telegram Vietnamese Review Findings

## Objective
Fix the two review findings from the Telegram Vietnamese normalization review: recognize `Đứng ngoài` as a no-bet recommendation and fix a Vietnamese typo in the revise prompt.

## Instructions

1. Modify `src/betting/odds-text-format.ts` in `formatMatchAnalysisMessage()`.
   - Locate the `isStandAside` regex around lines 330-333.
   - It currently starts with something equivalent to:
     ```ts
     /d[uứ]ng\s*(ngo[aà]i|l[aạ]i)|kh[oô]ng\s+(c[oó]\s+)?(k[eè]o|edge)/i
     ```
   - Change it so the initial letter can be `d`, `D`, `đ`, or `Đ` under the existing `i` flag. Use this exact pattern shape:
     ```ts
     /[dđ][uứ]ng\s*(ngo[aà]i|l[aạ]i)|kh[oô]ng\s+(c[oó]\s+)?(k[eè]o|edge)/i
     ```
   - Do not change the rest of `formatMatchAnalysisMessage()`.

2. Modify `tests/betting/odds-text-format.test.ts` in the test named `hides no-bet recommendation and internal verification state`.
   - Change the fixture field:
     ```ts
     recommendation: "Dung ngoai",
     ```
     to:
     ```ts
     recommendation: "Đứng ngoài",
     ```
   - Change the stale negative assertion:
     ```ts
     expect(message).not.toContain("KHUYẾN NGHỊ");
     ```
     to:
     ```ts
     expect(message).not.toContain("KÈO ĐỀ XUẤT");
     ```
   - Keep the existing assertions for `Thẩm định`, `Internal`, and `Tỷ số dự đoán`.

3. Modify `src/betting/betting-gemini.ts` in `REVISE_PROMPT`.
   - Replace the typo:
     ```text
     schema phân tich
     ```
     with:
     ```text
     schema phân tích
     ```
   - Do not alter the prompt schema, JSON field names, model names, parsing logic, or OpenRouter call logic.

4. Verify with focused test:
   ```bash
   npm run test -- tests/betting/odds-text-format.test.ts
   ```

5. Verify with full project checks:
   ```bash
   npm run test
   npm run build
   ```

6. Write `tasks/fix-telegram-vietnamese-review/result.md` with:
   - Files changed.
   - Exact verification commands run.
   - Whether each command passed or failed.
   - Any notes if a command fails.

## Acceptance Criteria
- [ ] `formatMatchAnalysisMessage()` does not render `🎯 *KÈO ĐỀ XUẤT*` when `recommendation` is `Đứng ngoài` and `picks` is empty.
- [ ] Legacy unaccented stand-aside strings like `Dung ngoai` remain supported by the regex.
- [ ] `tests/betting/odds-text-format.test.ts` covers the accented `Đứng ngoài` case.
- [ ] `src/betting/betting-gemini.ts` contains `phân tích`, not `phân tich`.
- [ ] `npm run test -- tests/betting/odds-text-format.test.ts` passes.
- [ ] `npm run test` passes.
- [ ] `npm run build` passes.

## Files to Touch
- `src/betting/odds-text-format.ts` — fix stand-aside regex.
- `tests/betting/odds-text-format.test.ts` — update no-bet test fixture and assertion.
- `src/betting/betting-gemini.ts` — fix prompt typo.
- `tasks/fix-telegram-vietnamese-review/result.md` — write worker result.

## Do Not Touch
- Do not change Telegram transport (`sendMessage`, `sendPhoto`, retry behavior).
- Do not change odds fetching, AI verification, Supabase persistence, or build output in `dist/`.
- Do not commit changes unless explicitly instructed by the Lead.
