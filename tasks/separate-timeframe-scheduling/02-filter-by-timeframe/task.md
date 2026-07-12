# Task 02: Lọc `loadOpenPositions`/`runCheckOpenTrades`/`pollPendingEntryOrders` theo timeframe

**Prerequisite**: Task 01 (cần schema `primary_timeframe` column).

**Objective**: Cập nhật 3 hàm chính để lọc dữ liệu theo `primary_timeframe` — mỗi task chỉ check/quản lý vị thế + pending orders của timeframe nó.

## Files to Modify

### 1. `src/charts/positions-repository-volman.ts`

#### Update `loadOpenPositions()`
```typescript
export async function loadOpenPositions(
  supabaseClient: SupabaseClient,
  timeframe: ChartTimeframe
): Promise<OpenPositionVolman[]> {
  const { data, error } = await supabaseClient
    .from('open_positions_volman')
    .select('*')
    .eq('primary_timeframe', timeframe)  // ADD FILTER
    .eq('status', 'open');
  
  if (error) throw error;
  return data || [];
}
```

#### Update `saveOpenPosition()`
```typescript
export async function saveOpenPosition(
  supabaseClient: SupabaseClient,
  position: Omit<OpenPositionVolman, 'id'>,
  timeframe: ChartTimeframe
): Promise<number> {
  // When saving, set primary_timeframe = timeframe
  const positionToSave = {
    ...position,
    primary_timeframe: timeframe
  };
  
  // Insert logic...
  // Check guard: WHERE pair = $1 (no timeframe filter — keep as is)
  // because Binance One-way: 1 symbol 1 position max across all timeframes
}
```

### 2. `src/charts/check-open-trades-runner-volman.ts`

#### Update `runCheckOpenTrades()`
```typescript
export async function runCheckOpenTrades(
  supabaseClient: SupabaseClient,
  timeframe: ChartTimeframe  // ADD PARAM
): Promise<void> {
  const openPositions = await loadOpenPositions(supabaseClient, timeframe);
  
  for (const position of openPositions) {
    // Check TP/SL for this position
    // ... rest of logic
  }
}
```

- Gọi `loadOpenPositions(supabaseClient, timeframe)` — sẽ tự filter.
- Không thay đổi logic check TP/SL/trailing — chỉ thay đổi scope data.

### 3. `src/charts/binance-execution-volman.ts`

#### Update `pollPendingEntryOrders()`
```typescript
export async function pollPendingEntryOrders(
  supabaseClient: SupabaseClient,
  timeframe: ChartTimeframe  // ADD PARAM
): Promise<void> {
  const openPositions = await loadOpenPositions(supabaseClient, timeframe);
  
  for (const position of openPositions) {
    if (position.binance_entry_order_status === 'pending') {
      // Poll order status
      // ... rest of logic
    }
  }
}
```

- Gọi `loadOpenPositions(supabaseClient, timeframe)`.
- Pending orders sẽ tự bị filter theo timeframe (vì open positions đã filter).

## Update Call Sites

### File: `src/charts/index.ts` (tạm thời — task 04 sẽ hoàn thiện)
Tìm nơi gọi `loadOpenPositions()`, `runCheckOpenTrades()`, `pollPendingEntryOrders()`:

```typescript
const timeframe = process.env.CHART_PRIMARY_TIMEFRAME as ChartTimeframe;

// OLD:
// const positions = await loadOpenPositions(supabaseClient);
// NEW:
const positions = await loadOpenPositions(supabaseClient, timeframe);

// OLD:
// await runCheckOpenTrades(supabaseClient);
// NEW:
await runCheckOpenTrades(supabaseClient, timeframe);

// OLD:
// await pollPendingEntryOrders(supabaseClient);
// NEW:
await pollPendingEntryOrders(supabaseClient, timeframe);
```

### Check: SMC Pipeline
- Nếu SMC pipeline cũng gọi `loadOpenPositions()` → update call site.
- Check files: `src/charts/deterministic-pipeline.ts`, `src/charts/check-open-trades-runner-smc.ts`.
- **Regression**: Ensure SMC test không break — `npx vitest run tests/charts/binance-execution-smc.test.ts`.

## Validation

### 1. TypeScript Compilation
- Run `npx tsc --noEmit` — strict mode, no errors.
- Check function signatures: `loadOpenPositions()`, `runCheckOpenTrades()`, `pollPendingEntryOrders()` all have `timeframe` param.

### 2. Test Suite
- Run `npx vitest run tests/charts/` — all tests pass.
- Specifically check:
  - `tests/charts/binance-execution-volman.test.ts` (if exists).
  - `tests/charts/deterministic-pipeline.test.ts` — ensure Volman flow not broken.
  - SMC tests: `tests/charts/binance-execution-smc.test.ts`, `tests/charts/check-open-trades-runner-smc.test.ts`.

### 3. Integration Check (if possible)
- Run `npm run analyze` với M15 timeframe, verify log shows only M15 positions checked.
- Log should contain: "Loaded [N] open positions for M15" or similar.

## Important Notes

- **Timeframe param bắt buộc** — không được default/skip nếu bị thiếu (tránh silent failure).
- **Regression check quan trọng**: SMC pipeline dùng chung file `binance-execution-shared.ts` → kiểm tra SMC flow không break.
- **Một-chiều guard vẫn giữ**: `saveOpenPosition()` check `WHERE pair = $1` không filter timeframe — vì Binance One-way 1 symbol 1 position, không quan trọng từ timeframe nào.

## Acceptance Criteria
- ✅ `loadOpenPositions(timeframe)`, `runCheckOpenTrades(timeframe)`, `pollPendingEntryOrders(timeframe)` nhận bắt buộc timeframe param.
- ✅ Các hàm filter data bằng `WHERE primary_timeframe = $1`.
- ✅ Call sites (index.ts, deterministic-pipeline.ts, etc.) updated với timeframe param.
- ✅ TypeScript strict mode pass: `npx tsc --noEmit`.
- ✅ All tests pass: `npx vitest run tests/charts/` (no regression).

## Result File
Ghi result tại `tasks/separate-timeframe-scheduling/02-filter-by-timeframe/result.md` với:
- Files modified: list with line numbers (function signatures, WHERE clause changes).
- Call site updates: which files changed, how timeframe param passed.
- Test results: `npx tsc --noEmit` + `npx vitest run` output.
- Regression check: SMC tests passed.

## Next Subtasks
- Task 03 (H1 support) và task 04 (wiring index.ts) có thể run độc lập sau task 02.
