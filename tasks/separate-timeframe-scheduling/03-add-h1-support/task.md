# Task 03: Thêm hỗ trợ đầy đủ timeframe H1 (interval mapping, validate list)

**Prerequisite**: Không có (task độc lập).

**Objective**: Thêm H1 vào danh sách timeframe hỗ trợ đầy đủ — interval mapping, config validation, OHLC provider fallback.

## Files to Modify

### 1. `src/charts/volman-charts.config.ts`

#### Update `TIMEFRAME_CONFIGS`
Tìm map hiện tại (M15, H4, D1) và thêm H1:

```typescript
export const TIMEFRAME_CONFIGS: Record<ChartTimeframe, TimeframeConfig> = {
  M15: {
    interval: '15m',
    binanceInterval: '15m',
    tvInterval: '15',
    // ... other fields
  },
  H1: {
    interval: '1h',
    binanceInterval: '1h',
    tvInterval: '60',
    // ... copy pattern from H4, adjust interval
  },
  H4: {
    interval: '4h',
    binanceInterval: '4h',
    tvInterval: '240',
    // ... existing
  },
  D1: {
    interval: '1d',
    binanceInterval: '1d',
    tvInterval: '1d',
    // ... existing
  },
};
```

**Intervals to use**:
- Binance API: `"1h"` (lowercase).
- TradingView: `"60"` (minutes).
- Internal: `"1h"` (descriptive).

### 2. `src/charts/ohlc-provider.ts`

#### Check/Add H1 Fallback in `fetchOHLC()`
Tìm hàm `fetchOHLC()` hoặc `getOHLCData()`:

```typescript
export async function fetchOHLC(
  symbol: string,
  timeframe: ChartTimeframe,
  limit: number = 100
): Promise<OHLCData[]> {
  const config = TIMEFRAME_CONFIGS[timeframe];
  
  if (!config) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }
  
  // Try Binance first
  try {
    return await binanceClient.klines({
      symbol,
      interval: config.binanceInterval,
      limit,
    });
  } catch (error) {
    // Fallback to TradingView if Binance fails
    return await tvClient.getCandles({
      symbol,
      interval: config.tvInterval,
      count: limit,
    });
  }
}
```

- H1 sẽ tự support khi TIMEFRAME_CONFIGS có mapping (không cần code thêm).
- Nếu có hardcoded list `["M15", "H4", "D1"]` → thêm `"H1"` vào.

### 3. `src/charts/chart-types-common.ts`

#### Verify `ChartTimeframe` type
Tìm định nghĩa enum/type:

```typescript
export type ChartTimeframe = "M15" | "H1" | "H4" | "D1";
```

- Nếu `"H1"` đã có → không cần thay đổi.
- Nếu chưa có → thêm `| "H1"`.

### 4. Validate List in Codebase

Tìm các nơi có hardcoded list timeframe:
```bash
grep -r "M15\|H4\|D1" src/ --include="*.ts" | grep -E "\[|\"" | head -20
```

- Thêm `"H1"` vào bất kỳ validate list / enum nào.
- Example: `const SUPPORTED_TIMEFRAMES = ["M15", "H1", "H4", "D1"];`

### 5. Backtest Config (if applicable)

Check `src/charts/setup-backtest.ts` hoặc `src/charts/setup-backtest-runner.ts`:

```typescript
// If hardcoded timeframe list exists:
const TIMEFRAMES_FOR_BACKTEST = ["M15", "H1", "H4"];  // Add H1
```

## Validation

### 1. TypeScript Compilation
- Run `npx tsc --noEmit` — strict mode, no errors.
- Type check: `ChartTimeframe` type includes "H1".

### 2. Config Verification
```bash
# Check TIMEFRAME_CONFIGS has H1
npm run analyze -- --help
# Or manually verify in volman-charts.config.ts
```

### 3. OHLC Fetch Test
- Manually test (if you have env setup): fetch M15, H1, H4 for a symbol.
- Log output should show successful fetch for all 3.

### 4. Test Suite
- Run `npx vitest run tests/charts/` — all tests pass.
- If there are tests for timeframe validation → verify H1 passes.

## Important Notes

- **Intervals are case-sensitive**:
  - Binance: `"1h"` (lowercase 1 + h).
  - TradingView: `"60"` (minutes).
- **No database migration needed** — H1 is a new timeframe, existing M15/H4/D1 data unaffected.
- **Backward compatible** — old configs with M15/H4/D1 still work.

## Acceptance Criteria
- ✅ `TIMEFRAME_CONFIGS` includes H1 with correct Binance (`"1h"`) and TV (`"60"`) intervals.
- ✅ `ChartTimeframe` type includes `"H1"`.
- ✅ All hardcoded timeframe lists updated (validated by grep).
- ✅ TypeScript strict mode pass: `npx tsc --noEmit`.
- ✅ Tests pass: `npx vitest run tests/charts/`.

## Result File
Ghi result tại `tasks/separate-timeframe-scheduling/03-add-h1-support/result.md` với:
- Files modified: `volman-charts.config.ts`, `chart-types-common.ts`, etc. (line numbers).
- H1 config values: interval mappings confirmed.
- Validation: grep output showing all timeframe lists updated.
- Test results: `npx tsc --noEmit` + `npx vitest run`.

## Next Subtasks
- Task 04 (wiring index.ts) sẽ benefit từ H1 support — có thể run sau task 03 hoàn thành.
