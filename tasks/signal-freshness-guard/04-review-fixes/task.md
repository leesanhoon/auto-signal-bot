# Task: Signal Freshness Guard — Fix Loop (Phase 4)

## Mục tiêu
Fix các issue từ Lead review để Signal Freshness Guard hoạt động đúng trong production.

## Issues Cần Fix (Thứ tự ưu tiên)

### ISSUE-1 (CRITICAL): Guard no-op vì truyền pair thay vì symbol

**File:** `src/charts/smc-index.ts`, `src/charts/index.ts`

**Vấn đề:** `setup.pair` = "USD/CAD" (production value), nhưng `fetchLastPrice` chỉ nhận "OANDA:USDCAD" → Error → setup không bị loại.

**Fix:**

**smc-index.ts:**
- Tại đầu `handleAnalysisResult`, build map pair→symbol từ `getPairs()`
- Dùng map này khi gọi `applySignalFreshnessGuard(setup, symbolByPair.get(setup.pair) ?? setup.pair)`

**index.ts (Volman):**
- Build map từ `CHARTS` config (pair = `chart.name.replace(/\s\w+$/, "")` to remove timeframe)
- Pass symbol qua map

### ISSUE-2 (HIGH): Guard chạy SAU auto-track

**File:** `src/charts/smc-index.ts`, `src/charts/index.ts`

**Vấn đề:** Auto-track saveOpenPosition chạy trước guard → setup stale vẫn được lưu → position repo bẩn.

**Fix:** Chuyển guard block (dòng khai báo ~ gán result.setups/noSetupReason) lên ĐẦU handleAnalysisResult, trước auto-track loop.

### ISSUE-5 (HIGH): Integration test không test wiring thật

**File:** `tests/charts/signal-freshness-integration.test.ts`

**Vấn đề:** Mock signal-freshness.js + chép lại logic test → test tự kiểm tra chính nó. Pair test = "OANDA:EURUSD" (wrong, production = "EUR/USD").

**Fix:**
- Mock CHỈ `fetchLastPrice` (mock `../../src/charts/ohlc-provider.js`)
- Call `applySignalFreshnessGuard` thật
- Dùng pair thật production: setup SHORT USD/CAD, entry 1.41657, TP1 1.41597, SL 1.41687, fresh price 1.41474 → assert BỊ LOẠI

### ISSUE-3 (HIGH): Candle close time sai (in giờ tương lai)

**File:** `src/shared/telegram-smc.ts`, `src/shared/telegram-volman.ts`

**Vấn đề:** `getCandleCloseTime` trả `floor(now/interval)*interval + interval` = giờ nến ĐANG chạy (tương lai), không phải nến đã đóng.

**Fix:**
```ts
const closeTimeMs = Math.floor(nowMs / intervalMs) * intervalMs; // bỏ + interval
const minutesAgo = Math.floor((nowMs - closeTimeMs) / 60000);     // bỏ bù
```

### ISSUE-4 (MEDIUM): Tuổi nến tính từ now, bỏ qua cache

**File:** `src/shared/telegram-smc.ts`, `src/shared/telegram-volman.ts`

**Vấn đề:** Khi gửi từ cache, `Date.now()` không phản ánh nến phân tích → dòng tuổi nến che giấu chính độ trễ.

**Fix (ưu tiên a):**
a) Truyền candle-close-ms thật xuống builder:
   - `smc-index.ts:173`: đã có `origin.candleKey`, parse để lấy close time
   - Pass vào `sendAllAnalysesSmc(..., { candleCloseMs })`
   - Builder dùng `candleCloseMs` để tính age

b) Fallback: thêm hậu tố ` — dữ liệu cache` khi `source === "cached"`

### Minor Issues

- M1: Typo `freshnesReasons` → `freshnessReasons` (smc-index.ts, index.ts)
- M2: Bỏ `as any` ở index.ts:224 — định nghĩa type structural cho signal-freshness
- M3: Đưa `TIMEFRAME_MS`/`getCandleCloseTime`/`formatCandleAge` vào module chung
- M4: Bỏ fallback `|| "M15"` (không cần sau fix ISSUE-3)

## Tests Bắt Buộc

1. **Integration test (ISSUE-5):** Setup SHORT USD/CAD stale, pair thật "USD/CAD", symbol "OANDA:USDCAD" → assert bị loại
2. **Candle age test (ISSUE-3):** Fake timer, 2026-07-10T12:32:00Z, M15 → assert message chứa "12:30 10/07 UTC" (NOT "12:45")
3. **All tests pass:** `npm run test`

## Acceptance Criteria

- `npm run build` pass
- `npm run test` pass (tất cả existing + new)
- Reproduction setup (SHORT USD/CAD, entry 1.41657, TP1 1.41597, price 1.41474) → BỊ LOẠI kèm reason rõ ràng
- Guard chạy TRƯỚC auto-track
- Candle age chỉ giờ đã đóng (≤ now), không phải tương lai
- Minor issues fixed
