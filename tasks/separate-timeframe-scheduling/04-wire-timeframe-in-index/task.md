# Task 04: Wiring `index.ts`: truyền timeframe + làm rõ Telegram message khi chặn do timeframe khác

**Prerequisite**: Task 02 (cần `loadOpenPositions(timeframe)` signature), Task 03 (H1 support).

**Objective**: 
1. Wire `CHART_PRIMARY_TIMEFRAME` env xuống `runCheckOpenTrades()`, `pollPendingEntryOrders()`.
2. Cải thiện Telegram message khi entry bị chặn do vị thế khác timeframe đã tồn tại.

## Files to Modify

### 1. `src/charts/index.ts`

#### Read `CHART_PRIMARY_TIMEFRAME` and Pass to Functions

```typescript
import { ChartTimeframe } from './chart-types-common';
import { runCheckOpenTrades } from './check-open-trades-runner-volman';
import { pollPendingEntryOrders } from './binance-execution-volman';

// In main analysis function:
export async function runAnalysis(): Promise<void> {
  const timeframe = process.env.CHART_PRIMARY_TIMEFRAME as ChartTimeframe;
  
  if (!timeframe) {
    throw new Error('CHART_PRIMARY_TIMEFRAME env variable is required');
  }
  
  // Validate timeframe
  const SUPPORTED_TIMEFRAMES: ChartTimeframe[] = ['M15', 'H1', 'H4', 'D1'];
  if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
    throw new Error(`Invalid timeframe: ${timeframe}. Must be one of: ${SUPPORTED_TIMEFRAMES.join(', ')}`);
  }
  
  // Pass timeframe to functions
  await runCheckOpenTrades(supabaseClient, timeframe);
  await pollPendingEntryOrders(supabaseClient, timeframe);
  
  // ... rest of analysis
}
```

### 2. `src/charts/binance-execution-shared.ts`

#### Improve Entry Guard Message (Prevent Timeframe Confusion)

Tìm hàm `executeEntry()` hoặc nơi check guard `existingPositionAmt !== 0`:

```typescript
// Current guard code (somewhere in entry flow):
if (existingPositionAmt !== 0) {
  // Message says: "Position already open, skipping"
  // IMPROVE TO: identify which timeframe owns the existing position
  
  const existingPosition = await loadOpenPositions(supabaseClient, null); // load ALL to find culprit
  const ownerTimeframe = existingPosition
    .find(p => p.pair === pair)?.primary_timeframe || 'unknown';
  
  const message = `⚠️ [${pair}] Entry blocked: position already open (owned by ${ownerTimeframe} timeframe). Skipping.`;
  
  await sendTelegramMessage(message);
  logger.info(message);
  return;
}
```

**Alternative (simpler)**: Check if position exists in different timeframe:
```typescript
if (existingPositionAmt !== 0) {
  const positionInThisTimeframe = await loadOpenPositions(supabaseClient, currentTimeframe);
  const positionExists = positionInThisTimeframe.some(p => p.pair === pair);
  
  if (!positionExists) {
    // Position exists but in different timeframe
    const message = `⚠️ [${pair}] Entry blocked: position already open in a different timeframe. Skipping.`;
  } else {
    // Position exists in same timeframe
    const message = `⚠️ [${pair}] Entry blocked: position already open. Skipping.`;
  }
  
  await sendTelegramMessage(message);
  return;
}
```

**Telegram Message Pattern**:
```
Signal: LONG/SHORT on [PAIR] at [PRICE]
Timeframe: [M15/H1/H4]
Status: ⚠️ BLOCKED — Position already open (different timeframe)
```

### 3. Update Entry Logic Function Signatures

Ensure all entry functions receive `timeframe` param:

```typescript
// src/charts/binance-execution-volman.ts
export async function executeEntryIfSignal(
  signal: VolumanSignal,
  timeframe: ChartTimeframe,  // ADD
  supabaseClient: SupabaseClient,
  binanceClient: BinanceClient
): Promise<void> {
  // Use timeframe in guard message
  const message = `Signal: ${signal.direction} on ${signal.pair} [${timeframe}]`;
  // ...
}
```

### 4. Call Site Updates in `index.ts`

Update all entry execution calls to pass timeframe:

```typescript
// OLD:
// await executeEntry(signal, supabaseClient, binanceClient);

// NEW:
await executeEntry(signal, timeframe, supabaseClient, binanceClient);
```

## Testing & Validation

### 1. TypeScript Compilation
- Run `npx tsc --noEmit` — strict mode, no errors.
- Check: `CHART_PRIMARY_TIMEFRAME` properly typed as `ChartTimeframe`.

### 2. Runtime Validation
- Missing/invalid env: script should error with clear message.
  ```bash
  unset CHART_PRIMARY_TIMEFRAME
  npm run analyze  # Should error: "CHART_PRIMARY_TIMEFRAME env variable is required"
  ```

- Valid env:
  ```bash
  export CHART_PRIMARY_TIMEFRAME=M15
  npm run analyze  # Should work
  ```

### 3. Test Suite
- Run `npx vitest run tests/charts/` — all tests pass.
- Specifically check entry tests (if exist): verify message generation.

### 4. Manual Test (Telegram message)
- If possible, trigger entry scenario with position already open (different TF).
- Check Telegram message shows timeframe info correctly.
- Log output shows: "Entry blocked: position already open (different timeframe)".

## Integration Check

- Run deterministic pipeline: `npm run analyze` with M15 env.
- Check logs:
  - "Loaded [N] open positions for M15"
  - "Polling pending entry orders for M15"
  - Entry attempt → Telegram message (if signal triggered).

## Important Notes

- **Error on missing env**: Not default to "M15" or "H4" — force user to specify.
- **Telegram message clarity**: Include timeframe info so user knows which task/TF blocked entry.
- **One-way guard still applies**: even if timeframe differs, guard `existingPositionAmt !== 0` still prevents entry (because Binance One-way: 1 symbol 1 position max).

## Acceptance Criteria
- ✅ `runCheckOpenTrades()`, `pollPendingEntryOrders()` called with `timeframe` param in `index.ts`.
- ✅ `CHART_PRIMARY_TIMEFRAME` env read, validated, passed to functions.
- ✅ Entry guard detects different-timeframe position, sends improved Telegram message.
- ✅ Error if env missing: script exits with clear error message.
- ✅ TypeScript strict mode pass: `npx tsc --noEmit`.
- ✅ Tests pass: `npx vitest run tests/charts/`.

## Result File
Ghi result tại `tasks/separate-timeframe-scheduling/04-wire-timeframe-in-index/result.md` với:
- Files modified: `index.ts`, `binance-execution-shared.ts` (line numbers, changes).
- Env validation: error handling, supported timeframes list.
- Telegram message examples: before/after improvements.
- Test results: `npx tsc --noEmit` + `npx vitest run` output.
- Integration check: `npm run analyze` log showing timeframe handling.

## Next Subtasks
- Task 05 (Task Scheduler setup) phụ thuộc task 04 (cần env setup hoạt động).
