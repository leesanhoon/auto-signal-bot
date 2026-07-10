# Task 02: freshness-guard-core

## Mục tiêu
Implement core freshness guard logic trong file mới `src/charts/signal-freshness.ts`.
Hàm này lọc setup "ôi thiu" (signal đã chết) bằng cách so sánh giá tươi với TP1/SL.

## Yêu cầu chức năng

### Hàm chính: `applySignalFreshnessGuard()`

```typescript
export async function applySignalFreshnessGuard(
  setup: Setup,
  symbol: string,
): Promise<Setup | Error>
```

**Input:**
- `setup`: Setup object (có fields như `side` (LONG/SHORT), `entryPrice`, `stopLoss`, `targetPrice1`, ...)
- `symbol`: Trading symbol (e.g., "OANDA:EURUSD")

**Output:**
- Success: `Setup` object (có thể bị modify field `noSetupReason` nếu stale, hoặc giữ nguyên nếu fresh)
- Error: Trả Error object nếu fetch giá tươi fail (nhưng error này KHÔNG làm chặn signal; caller sẽ xử lý)

### Logic

1. **Fetch giá tươi**: Dùng `fetchLastPrice(symbol)` từ subtask 01
2. **Nếu fetch fail** (return Error):
   - Log warning: "Khong xac minh duoc gia hien tai cho {symbol}: {error}"
   - **VẪN RETURN setup unchanged** (không chặn delivery)
3. **Nếu fetch success**, kiểm tra stale:
   - Tùy vào `setup.side`:
     - **LONG**: Giá đã chạm/vượt TP1 (`lastPrice >= tp1`) HOẶC vượt SL (`lastPrice <= sl`)
     - **SHORT**: Giá đã chạm/vượt TP1 (`lastPrice <= tp1`) HOẶC vượt SL (`lastPrice >= sl`)
   - Nếu stale → Set `setup.noSetupReason = "Gia da vuot TP1/SL (check gia tuc)"` và return
   - Nếu fresh → Return setup unchanged

### Env var & Config

- `SIGNAL_FRESHNESS_GUARD_ENABLED` (default `true`, type boolean)
- Nếu disabled → hàm chỉ return setup unchanged (no-op)
- Giúp debug & disable nhanh nếu cần

### Không thay đổi

- Không fetch OHLC history (chỉ fetch lastPrice từ ticker)
- Không cache kết quả fetch price (mỗi lần call đều fetch tươi)
- Không modify các field khác của setup ngoài `noSetupReason`

## Tests

Tạo `tests/charts/signal-freshness.test.ts`:

### Test case 1: Feature disabled
- `SIGNAL_FRESHNESS_GUARD_ENABLED=false`
- Input: setup LONG với giá đã vượt TP1
- Output: Setup unchanged, noSetupReason không được set

### Test case 2: LONG setup, giá chưa vượt TP1 (fresh)
- Fetch giá tươi = 1.1050
- Setup: side=LONG, entry=1.1000, TP1=1.1100, SL=0.9900
- Output: Setup unchanged (fresh)

### Test case 3: LONG setup, giá đã vượt TP1 (stale)
- Fetch giá tươi = 1.1150 (vượt TP1=1.1100)
- Setup: side=LONG, entry=1.1000, TP1=1.1100, SL=0.9900
- Output: setup.noSetupReason = "Gia da vuot TP1/SL..."

### Test case 4: LONG setup, giá vượt SL (stale)
- Fetch giá tươi = 0.9850 (dưới SL=0.9900)
- Setup: side=LONG, entry=1.1000, TP1=1.1100, SL=0.9900
- Output: setup.noSetupReason = "Gia da vuot TP1/SL..."

### Test case 5: SHORT setup, giá chưa vượt TP1 (fresh)
- Fetch giá tươi = 1.0950
- Setup: side=SHORT, entry=1.1000, TP1=1.0900, SL=1.1100
- Output: Setup unchanged (fresh)

### Test case 6: SHORT setup, giá đã vượt TP1 (stale)
- Fetch giá tươi = 1.0850 (dưới TP1=1.0900)
- Setup: side=SHORT, entry=1.1000, TP1=1.0900, SL=1.1100
- Output: setup.noSetupReason = "Gia da vuot TP1/SL..."

### Test case 7: SHORT setup, giá vượt SL (stale)
- Fetch giá tươi = 1.1150 (trên SL=1.1100)
- Setup: side=SHORT, entry=1.1000, TP1=1.0900, SL=1.1100
- Output: setup.noSetupReason = "Gia da vuot TP1/SL..."

### Test case 8: Fetch giá fail → setup vẫn được return
- Mock `fetchLastPrice()` return Error
- Output: Setup unchanged, log warning

### Test case 9: Invalid symbol (e.g., Binance symbol không được support)
- Fetch fail → Setup unchanged, log warning

## Dependencies

- `src/charts/ohlc-provider.ts`: `fetchLastPrice()` (từ subtask 01)
- `src/charts/chart-types-common.ts`: `Setup` type
- `src/shared/logger.js`: `createLogger()`

## Acceptance criteria

- `npm run build` pass
- `npm run test` pass (tất cả 9 test cases)
- Hàm được export từ `signal-freshness.ts`
- Không modify field khác của setup
- Lỗi fetch không chặn delivery (return setup unchanged)
- Config `SIGNAL_FRESHNESS_GUARD_ENABLED` hoạt động đúng
