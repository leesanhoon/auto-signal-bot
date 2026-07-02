# Task: Implement retry utility

## Objective
Create a reusable retry utility function with exponential backoff.

## Instructions
1. Create `src/utils/retry.ts` with:
   - Export `RetryOptions` interface: `{ maxRetries: number (default 3), baseDelay: number (default 1000) }`
   - Export `retry<T>(fn: () => Promise<T>, options?: Partial<RetryOptions>): Promise<T>`
   - Implement exponential backoff: delay = baseDelay * 2^attempt + random jitter (0-100ms)
   - On transient error (catch all), wait for delay then retry
   - After maxRetries exhausted, throw the last error

2. Update `src/api/client.ts`:
   - Import `retry` from `../utils/retry`
   - Wrap the existing `fetchData` call with `retry(fetchData, { maxRetries: 3 })`

## Acceptance Criteria
- [ ] `retry` function exists with correct signature
- [ ] Backoff formula: `delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100`
- [ ] Throws after exhausting maxRetries
- [ ] `fetchData` is wrapped with retry

## Files to Touch
- `src/utils/retry.ts` — new file
- `src/api/client.ts` — modify fetchData call