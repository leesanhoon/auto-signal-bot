# Review — Subtask 03: integrate-smc-volman

**Verdict: CHANGES_REQUIRED**

## ISSUE-1 (CRITICAL): truyền `setup.pair` thay vì symbol → guard no-op

**Vị trí:**
- `src/charts/smc-index.ts:154` — `applySignalFreshnessGuard(setup, setup.pair)`
- `src/charts/index.ts:224` — `applySignalFreshnessGuard(setup as any, setup.pair)`

**Vấn đề:** `setup.pair` có dạng `"USD/CAD"` (xuất phát từ `chart.name`).
`fetchLastPrice` chỉ nhận `OANDA:XXXYYY` hoặc `BINANCE:XXXXXX` → trả Error →
`applySignalFreshnessGuard` log warning rồi trả setup nguyên vẹn. Kết quả:
**không một setup forex nào bị lọc, tính năng chết lặng trong production.**

**Bằng chứng runtime** (Lead chạy 2026-07-10):

```
Input : SHORT USD/CAD entry 1.41657, SL 1.41687, TP1 1.41597 (giá thật đã 1.41474)
Output: noSetupReason: (khong co — setup van duoc GUI)
WARN  : Khong xac minh duoc gia hien tai cho USD/CAD:
        Symbol khong dung dinh dang OANDA:XXXYYY: "USD/CAD"
```

**Fix yêu cầu:**
1. `smc-index.ts`: dùng `getPairs()` có sẵn (dòng ~42, trả `{pair, symbol}`)
   → build `const symbolByPair = new Map(getPairs().map(p => [p.pair, p.symbol]))`
   → gọi `applySignalFreshnessGuard(setup, symbolByPair.get(setup.pair) ?? setup.pair)`.
2. `index.ts` (Volman): build map tương tự từ `CHARTS` của
   `volman-charts.config.ts` (pair = `chart.name.replace(\` ${chart.timeframe}\`, "")`,
   giống hệt cách smc-index làm).
3. Khi không map được pair → giữ setup + log warning (hành vi fail-open hiện
   tại của guard đã đúng, chỉ cần wiring đúng).

## ISSUE-2 (HIGH): guard đặt SAU auto-track

**Vị trí:** `smc-index.ts` — auto-track loop dòng ~117-147 chạy trước guard
dòng 150-171. `index.ts` bố cục tương tự.

**Vấn đề:** setup MARKET_NOW đã stale (giá vượt TP1/SL) vẫn được
`saveOpenPosition` TRƯỚC khi guard loại nó khỏi message → position repo chứa
lệnh mở tại giá không còn tồn tại → performance tracking sai, các run
check-open-trades sau xử lý lệnh ma.

plan.md đã ghi: "đặt guard TRƯỚC auto-track để không saveOpenPosition cho
setup chết".

**Fix yêu cầu:** chuyển nguyên khối guard (khai báo → gán `result.setups`/
`result.noSetupReason`) lên đầu `handleAnalysisResult`, trước vòng auto-track,
ở CẢ HAI file.

## ISSUE-5 (HIGH, test): integration test không test wiring thật

**Vị trí:** `tests/charts/signal-freshness-integration.test.ts`

- `vi.mock` toàn bộ `signal-freshness.js` rồi CHÉP LẠI vòng lặp filter vào
  trong test → test tự kiểm tra chính nó, không kiểm tra code production.
- Mock data dùng `pair: "OANDA:EURUSD"` — pair thật trong production là
  `"EUR/USD"` → che đúng cái bug ISSUE-1.

**Fix yêu cầu:** viết lại: chỉ mock `fetchLastPrice` (mock
`../../src/charts/ohlc-provider.js`), gọi `applySignalFreshnessGuard` THẬT,
pair/symbol dùng giá trị thật (`"USD/CAD"` / `"OANDA:USDCAD"`). Thêm test
tái hiện sự cố: SHORT entry 1.41657 / TP1 1.41597 / SL 1.41687, fresh price
1.41474 → setup bị loại, reason chứa giá.

## Minor

- M1: typo `freshnesReasons` (smc-index.ts:150,156,167,168; index.ts:220,226,237,238).
- M2: bỏ `as any` tại index.ts:224 — sửa `signal-freshness.ts` nhận type
  structural tối thiểu thay vì `TradeSetup` của riêng SMC.
