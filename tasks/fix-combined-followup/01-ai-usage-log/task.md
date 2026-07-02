# Task 01 — Fix Combined AI usage/log real tokens

## Objective
Fix `generateCombinedAnalysis()` in `src/betting/betting-gemini.ts` so AI usage/log records real OpenRouter response tokens instead of fake `0` tokens.

## Files allowed
- Modify: `src/betting/betting-gemini.ts`
- Modify tests if needed: `tests/betting/betting-gemini.test.ts`

## Current issue
At the end of `generateCombinedAnalysis()`, the `finally` block calls:
```ts
logStageMetrics("combined", payloads[0], request.model, latencyMs, { text: "", usage: { promptTokens: 0, completionTokens: 0 } }, 1, usedFallback);
recordStageUsage("combined", { text: "", usage: { promptTokens: 0, completionTokens: 0 } }, request.model, ...);
```
This produces fake usage rows with `input=0, output=0`.

## Required implementation
1. Remove the fake-response `finally` logging/usage block.
2. After primary OpenRouter call succeeds, before returning parsed plan:
   - compute `latencyMs`
   - call `logStageMetrics("combined", payloads[0], primaryRequest.model, latencyMs, response, requestCount, false)`
   - call `recordStageUsage("combined", response, primaryRequest.model, { latencyMs, requestCount, fallbackUsed: false, timeoutMs: COMBINED_TIMEOUT_MS, finishReason: response.finishReason ?? "stop" })`
3. If primary throws fallback-trigger error and fallback succeeds:
   - log/record using fallback `response`, fallback model, `usedFallback=true`, and total/actual request count
4. If all requests fail before a response exists, do not call `recordStageUsage()`.
5. Keep web plugin enabled for primary combined request.

## Suggested pattern
Use `const { response, requestCount } = await callOpenRouterWithCount(...)` in both primary and fallback branches.

## Acceptance criteria
- No fabricated `{ promptTokens: 0, completionTokens: 0 }` response remains in `generateCombinedAnalysis()`.
- Primary success records real usage.
- Fallback success records real usage.
- Full TypeScript passes.

## Verification commands
```bash
cd H:/LeeSanHoon/auto-signal-bot
npx tsc --noEmit
npm test -- tests/betting/betting-gemini.test.ts
```

## Result file
Write summary and command outputs to:
`tasks/fix-combined-followup/01-ai-usage-log/result.md`
