# Task 02 — Apply task 04 review fixes

## Objective
Fix robustness issues found in `tasks/combined-match-analysis/04-odds-runner/review.md`.

## Files allowed
- Modify: `src/betting/odds-runner.ts`
- Modify: `tests/betting/odds-runner.test.ts`

## Required changes

### 1. Guard optional fields from AI output
In `buildCombinedMatchAnalysis()`, current code assumes arrays exist:
```ts
picks: match.topPicks.map(...),
keyPoints: Array.from(match.keyPoints).slice(0, 2),
risks: Array.from(match.risks).slice(0, 2),
```

Change to defensive handling:
```ts
const topPicks = Array.isArray(match.topPicks) ? match.topPicks : [];
const keyPoints = Array.isArray(match.keyPoints) ? match.keyPoints.slice(0, 2) : [];
const risks = Array.isArray(match.risks) ? match.risks.slice(0, 2) : [];
```
Then use `topPicks`, `keyPoints`, `risks` in returned `MatchAiAnalysis`.

### 2. Avoid duplicate raw odds fallback message
The runner already sends combined raw odds before calling AI. If AI returns null, do not send the entire raw odds again. Replace:
```ts
await sendMessage(`⚠️ AI không phân tích được. Dữ liệu odds thô:\n\n${formatCombinedOddsMessage(payload)}`);
```
with:
```ts
await sendMessage("⚠️ AI không phân tích được. Đã gửi dữ liệu odds thô phía trên.");
```

## Tests to add/update
Add or update a test in `tests/betting/odds-runner.test.ts`:
- mock `generateCombinedAnalysis()` to return a match missing `keyPoints` and `risks` (cast as needed)
- assert `runOddsCheck()` resolves, sends analysis, and saves snapshot without throwing
- mock `generateCombinedAnalysis()` to return `null`
- assert fallback warning does not include duplicate `RAW:` raw odds body twice

## Acceptance criteria
- `runOddsCheck()` does not throw if AI omits optional arrays.
- AI failure fallback sends concise warning only.
- Existing combined runner tests still pass.

## Verification commands
```bash
cd H:/LeeSanHoon/auto-signal-bot
npx tsc --noEmit
npm test -- tests/betting/odds-runner.test.ts
```

## Result file
Write summary and command outputs to:
`tasks/fix-combined-followup/02-review-task04-fixes/result.md`
