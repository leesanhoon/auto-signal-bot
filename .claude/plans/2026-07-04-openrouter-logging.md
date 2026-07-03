# Plan: Add Detailed OpenRouter Logging to Betting AI

## Mục tiêu (Objective)

Enhance logging in `src/betting/betting-gemini.ts` when calling OpenRouter API to provide detailed insights into:
- Which AI model is being used (primary vs fallback)
- Estimated input tokens before sending the request
- Actual token counts from response (input, output, cached)
- Request/response timing and latency
- Request attempt counts (retries)

This improves debugging, cost tracking, and performance monitoring for betting AI operations.

## Các bước (Steps)

### Step 1: Create Token Estimation Utility (src/shared/token-estimate.ts)
**Line numbers reference:** New file

Create a new utility module to estimate tokens based on text content. This will provide estimated input tokens before making the API call:

```typescript
// Key functions:
- estimateTokensForText(text: string): number
  // Use approximate 1 token ≈ 4 characters rule as baseline
  // More sophisticated estimation: tokenizer-like approach for better accuracy
  // Returns: estimated token count

- estimateTokensForRequest(request: OpenRouterRequest): {
    estimatedPromptTokens: number,
    estimatedContentSize: number,
    breakdown?: {
      systemPromptTokens?: number,
      userContentTokens?: number,
      jsonFormatOverhead?: number
    }
  }
  // Aggregates system prompt, user content tokens
  // Accounts for JSON response format overhead (~50 tokens)
```

**Rationale:** Provides pre-request estimates for logging before actual response.

### Step 2: Update OpenRouter Response Type (src/shared/openrouter.ts)
**Line numbers:** Currently lines 22-26

Enhance the `OpenRouterResponse` type to include additional metadata:

```typescript
// Add to OpenRouterResponse type:
export type OpenRouterResponse = {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
  };
  finishReason?: string;
  // Add:
  requestDurationMs?: number;  // Track actual API call duration
};
```

**Rationale:** Captures actual timing of the API call at the source.

### Step 3: Measure Request Timing in callOpenRouter (src/shared/openrouter.ts)
**Line numbers:** Lines 52-124

Modify `callOpenRouter` function to measure the actual request duration:

```typescript
// Inside callOpenRouter function, around line 66:
const startTime = Date.now();
// ... fetch call ...
const requestDurationMs = Date.now() - startTime;

// Return response with requestDurationMs included
return {
  text: text.trim(),
  usage: { ... },
  finishReason,
  requestDurationMs,  // Add this
};
```

**Rationale:** Separates API request timing from overall operation timing (accounting for retries).

### Step 4: Enhance betting-gemini.ts Logging (src/betting/betting-gemini.ts)

#### 4a. Create Helper: logOpenRouterRequest() 
**New function to add after line 589:**

```typescript
function logOpenRouterRequest(
  stage: "analyze" | "combined" | "plan",
  model: string,
  request: OpenRouterRequest,
  estimatedTokens: ReturnType<typeof estimateTokensForRequest>,
): void {
  const systemSize = estimatedTokens.breakdown?.systemPromptTokens ?? 0;
  const userSize = estimatedTokens.breakdown?.userContentTokens ?? 0;
  const overhead = estimatedTokens.breakdown?.jsonFormatOverhead ?? 0;

  logger.debug(
    `[${stage}] OpenRouter request: model=${model}, ` +
    `estimatedPrompt=${estimatedTokens.estimatedPromptTokens} tokens ` +
    `(system=${systemSize} + user=${userSize} + overhead=${overhead}), ` +
    `maxTokens=${request.maxTokens}, ` +
    `temperature=${request.temperature}`,
  );
}
```

#### 4b. Enhance logStageMetrics()
**Current lines 576-588, replace with:**

```typescript
function logStageMetrics(
  stage: "analyze" | "combined" | "plan",
  payload: MatchOddsPayload,
  model: string,
  latencyMs: number,
  response: Awaited<ReturnType<typeof callOpenRouter>>,
  requestCount: number,
  usedFallback: boolean,
  estimatedInputTokens?: number,
): void {
  const requestDurationMs = response.requestDurationMs ?? latencyMs;
  const avgRequestMs = requestCount > 0 ? Math.round(requestDurationMs / requestCount) : 0;
  
  logger.info(
    `  ✓ ${stage} ${payload.home} vs ${payload.away}: ` +
    `totalLatency=${latencyMs}ms, ` +
    `apiDuration=${requestDurationMs}ms (${requestCount} requests, avg=${avgRequestMs}ms/req), ` +
    `model=${model}, ` +
    `tokens: ` +
    `estimated_input=${estimatedInputTokens ?? "N/A"} → ` +
    `actual_input=${response.usage.promptTokens}, ` +
    `actual_output=${response.usage.completionTokens}` +
    `${response.usage.cachedTokens ? ` (cached=${response.usage.cachedTokens})` : ""}, ` +
    `fallback=${usedFallback ? "yes" : "no"}`,
  );
}
```

#### 4c. Update analyzeMatchOdds() 
**Current lines 703-743, modify:**

```typescript
export async function analyzeMatchOdds(
  payload: MatchOddsPayload,
): Promise<MatchAiAnalysis> {
  const startedAt = Date.now();
  const primaryRequest = buildAnalyzeMatchOddsRequest(payload);
  
  // NEW: Estimate tokens before request
  const estimatedTokens = estimateTokensForRequest(primaryRequest);
  logOpenRouterRequest("analyze", primaryRequest.model, primaryRequest, estimatedTokens);

  const run = await runOpenRouterStage(primaryRequest, {
    fallbackRequest: { ... },
    fallbackOnError: isProFallbackTrigger,
  });
  
  const latencyMs = Date.now() - startedAt;
  
  // UPDATED: Pass estimatedInputTokens to logging
  logStageMetrics(
    "analyze",
    payload,
    run.model,
    latencyMs,
    run.response,
    run.requestCount,
    run.usedFallback,
    estimatedTokens.estimatedPromptTokens,  // NEW
  );
  
  recordStageUsage("analyze", run.response, run.model, {
    latencyMs,
    requestCount: run.requestCount,
    fallbackUsed: run.usedFallback,
    timeoutMs: ANALYZE_TIMEOUT_MS,
    webResults: run.usedFallback ? 0 : ANALYZE_WEB_RESULTS,
    analyzeModel: ANALYZE_MODEL,
    fallbackModel: FALLBACK_MODEL,
    // NEW: Add token estimation info to metadata
    estimatedInputTokens: estimatedTokens.estimatedPromptTokens,
    apiDurationMs: run.response.requestDurationMs,
  });
  
  // ... rest of function
}
```

#### 4d. Update generateCombinedAnalysis() 
**Current lines 1186-1319, similar modifications:**

```typescript
export async function generateCombinedAnalysis(
  payloads: MatchOddsPayload[],
): Promise<CombinedAnalysisPlan | null> {
  if (payloads.length === 0) return null;
  const startedAt = Date.now();

  const primaryRequest: OpenRouterRequest = { ... };
  
  // NEW: Estimate tokens
  const estimatedTokens = estimateTokensForRequest(primaryRequest);
  logOpenRouterRequest("combined", primaryRequest.model, primaryRequest, estimatedTokens);

  try {
    const { response, requestCount } = await callOpenRouterWithCount(
      primaryRequest,
      isTransientRetryableError,
    );
    const latencyMs = Date.now() - startedAt;
    
    // UPDATED: Pass estimated tokens to logging
    logStageMetrics(
      "combined",
      payloads[0],
      primaryRequest.model,
      latencyMs,
      response,
      requestCount,
      false,
      estimatedTokens.estimatedPromptTokens,  // NEW
    );
    
    recordStageUsage("combined", response, primaryRequest.model, {
      latencyMs,
      requestCount,
      fallbackUsed: false,
      timeoutMs: COMBINED_TIMEOUT_MS,
      finishReason: response.finishReason ?? "stop",
      // NEW:
      estimatedInputTokens: estimatedTokens.estimatedPromptTokens,
      apiDurationMs: response.requestDurationMs,
    });
    
    // ... rest of function (also add to fallback branch around line 1281)
  } catch (...) { ... }
}
```

#### 4e. Update generateBettingPlan()
**Current lines 907-985, add similar logging:**

Add token estimation and enhanced logging for plan generation, similar to analyze and combined functions.

### Step 5: Update Imports in betting-gemini.ts
**After line 19, add:**

```typescript
import { estimateTokensForRequest } from "../shared/token-estimate.js";
```

## Files cần sửa/tạo (Files to modify/create)

| File | Action | Key Changes |
|------|--------|-------------|
| `src/shared/token-estimate.ts` | CREATE | New utility for token estimation (200-250 lines) |
| `src/shared/openrouter.ts` | MODIFY | Add `requestDurationMs` to response type; measure timing in fetch call |
| `src/betting/betting-gemini.ts` | MODIFY | Add logging functions, enhance existing metrics logging, add token estimation calls |

## Rủi ro & Lưu ý (Risks & Notes)

### Token Estimation Accuracy
- **Risk:** Estimated tokens may differ from actual API token count (varies by model tokenizer)
- **Mitigation:** Display estimated vs actual for comparison; log both in structured format; use as advisory data only
- **Note:** OpenRouter returns actual counts, so this is pre-request guidance only

### Performance Impact
- **Risk:** Token estimation could add latency (string analysis)
- **Mitigation:** Keep estimation lightweight; simple character-based formula for initial impl; optimize if needed
- **Note:** Token estimation should be <10ms overhead

### Backward Compatibility
- **Risk:** Adding optional fields to response types could break strict equality checks
- **Mitigation:** Keep `requestDurationMs` optional; existing code ignores it safely
- **Note:** This is additive, no breaking changes

### Logging Verbosity
- **Risk:** New debug logs might clutter output in production
- **Mitigation:** Use `logger.debug()` for pre-request estimates; `logger.info()` for final metrics
- **Note:** Can be controlled via LOG_LEVEL env var

### Cached Token Handling
- **Risk:** OpenRouter may cache prompts; cached tokens reduce actual input cost but need proper tracking
- **Mitigation:** Already handled in `ai-usage.ts` (line 586-592); logging will display separately
- **Note:** Ensure metadata in `recordOpenRouterUsage` includes cachedTokens correctly

## Test Cases

### Test 1: Token Estimation Accuracy
```
Test: estimateTokensForText() produces reasonable estimates
- Input: A betting analysis prompt ~500 words
- Expected: Estimated tokens within 20% of actual prompt tokens
- Verify: Compare estimate vs actual from OpenRouter response
```

### Test 2: analyzeMatchOdds() Logging
```
Test: analyzeMatchOdds() logs model, estimated and actual tokens
- Input: Single match payload
- Expected logs:
  - [DEBUG] OpenRouter request with model name and estimated tokens
  - [INFO] Stage metrics with actual tokens and API duration
  - Metadata recorded includes estimatedInputTokens and apiDurationMs
```

### Test 3: Combined Analysis Logging
```
Test: generateCombinedAnalysis() tracks token estimates through retry path
- Input: Multiple match payloads, mock primary model to timeout
- Expected:
  - Primary request logs estimated tokens
  - Fallback request logs estimated tokens for fallback model
  - Final metrics show correct requestCount and token usage
```

### Test 4: Plan Generation Logging
```
Test: generateBettingPlan() includes token estimation in logs
- Expected: Model name, estimated prompt tokens, and response tokens in metrics
```

### Test 5: Response Duration Tracking
```
Test: requestDurationMs from API is separate from overall latencyMs
- Input: Multiple retries (requestCount > 1)
- Expected:
  - latencyMs includes retry delays
  - requestDurationMs reflects just the last/final API call
  - avgRequestMs = requestDurationMs / requestCount
```

## Ước tính thời gian (Time estimate)

| Task | Time |
|------|------|
| Create token-estimate.ts utility | 30 min |
| Update openrouter.ts response type & timing | 20 min |
| Add logging functions to betting-gemini.ts | 25 min |
| Update analyzeMatchOdds() | 15 min |
| Update generateCombinedAnalysis() | 15 min |
| Update generateBettingPlan() | 10 min |
| Write unit tests for token estimation | 30 min |
| Integration testing (manual/automation) | 30 min |
| Code review & refinement | 15 min |
| **Total** | **190 minutes (~3.2 hours)** |

### Effort Breakdown
- **Implementation:** ~115 min
- **Testing:** ~60 min
- **Review/Polish:** ~15 min

### Complexity: Medium
- Token estimation is straightforward (character-based initially)
- Logging is additive to existing code
- No major refactoring required
- Main challenge: ensuring accurate token estimates and consistent logging format

### Dependencies
- None (only internal modules)
- No new npm packages required
- Existing logger and response types sufficient

### Future Improvements (Out of Scope)
- Use actual tokenizer library (js-tiktoken) for more accurate estimates
- Add prometheus metrics export for token usage
- Implement token budget alerting in betting operations
- Add structured logging fields for ELK/CloudWatch integration
