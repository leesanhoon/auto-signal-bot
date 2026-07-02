# Plan: Example — Add retry logic to fetchData function

## Architecture
- Add a reusable `retry` utility in `src/utils/retry.ts`
- Wrap existing `fetchData` call in `src/api/client.ts` with retry
- Use exponential backoff with jitter

## Implementation
- `src/utils/retry.ts`: `retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>`
- `src/api/client.ts`: Import and wrap `fetchData` with `retry(fetchData, { maxRetries: 3, baseDelay: 1000 })`

## Testing Strategy
- Unit test for retry utility with mock failing function
- Integration test verifying retry behavior

## Edge Cases & Error Handling
- All retries exhausted → throw original error
- Empty options → use defaults (3 retries, 1s base delay)
- fn never succeeds → reject after maxRetries