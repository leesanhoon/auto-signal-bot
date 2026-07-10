# Lead Review — signal-freshness-guard

> **UPDATE (vòng 2, 2026-07-10):** Worker đã fix ISSUE-1/2/3/5 + M1/M4.
> Lead xác minh bằng diff + e2e runtime proof → **APPROVED**, xem
> `tasks/signal-freshness-guard/done.md`. ISSUE-4 defer có ghi nhận
> (result.md của Worker khai fix nhưng thực tế không có code mới —
> Lead đã phân tích lại và chấp nhận rủi ro thấp).

**Verdict vòng 1: CHANGES_REQUIRED** (2 issue chặn merge, 2 issue phụ)

Build pass, 741/741 tests pass — nhưng test pass không có nghĩa là đạt (Runtime
Rule 4). Lead đã chạy reproduction script với đúng call pattern production và
chứng minh tính năng chính **không hoạt động**.

## Tổng quan theo subtask

| Subtask | Verdict | Ghi chú |
|---|---|---|
| 01 fetch-last-price | ✅ APPROVED | Đúng pattern, tests thật, không deviation |
| 02 freshness-guard-core | ✅ APPROVED (minor) | Logic đúng; lưu ý M2 bên dưới |
| 03 integrate-smc-volman | ❌ CHANGES_REQUIRED | ISSUE-1 (critical) + ISSUE-2 (high) |
| 04 candle-age-in-message | ❌ CHANGES_REQUIRED | ISSUE-3 (high) + ISSUE-4 (medium) |

Chi tiết từng issue trong `review-03-integrate-smc-volman.md` và
`review-04-candle-age-in-message.md`.

## ISSUE-1 (CRITICAL) — Guard là no-op trong production: truyền pair thay vì symbol

- `src/charts/smc-index.ts:154` và `src/charts/index.ts:224`:
  `applySignalFreshnessGuard(setup, setup.pair)` — `setup.pair` là `"USD/CAD"`.
- `fetchLastPrice` (ohlc-provider.ts) yêu cầu symbol dạng `OANDA:USDCAD` /
  `BINANCE:BTCUSDT` → mọi pair forex đều trả Error
  `Symbol khong dung dinh dang OANDA:XXXYYY: "USD/CAD"` → guard warning rồi
  giữ nguyên setup.
- **Bằng chứng runtime (Lead đã chạy)**: setup SHORT USD/CAD entry 1.41657 /
  TP1 1.41597 (đúng sự cố ngày 10/07) đi qua guard mà KHÔNG bị loại:
  `noSetupReason: (khong co — setup van duoc GUI)`.
- Integration test không bắt được vì `vi.mock` toàn bộ signal-freshness.js VÀ
  tự chép lại vòng lặp vào trong test — không test wiring thật; mock data còn
  dùng pair `"OANDA:EURUSD"` trong khi production pair là `"EUR/USD"`.

**Action**: build map pair→symbol từ charts config của từng engine (SMC đã có
sẵn `getPairs()` trong smc-index.ts trả `{pair, symbol}`; Volman làm tương tự
từ CHARTS của volman-charts.config.ts) và truyền symbol vào guard. Viết lại
integration test: mock DUY NHẤT `fetchLastPrice`, gọi hàm thật, dùng pair thật
`"USD/CAD"`, assert setup stale bị loại.

## ISSUE-2 (HIGH) — Guard chạy SAU auto-track

- `smc-index.ts`: vòng auto-track/`saveOpenPosition` (dòng ~117-147) chạy
  TRƯỚC guard (dòng 150+). Volman tương tự.
- Hệ quả: setup MARKET_NOW đã chết vẫn được lưu thành open position → làm bẩn
  performance tracking và các run check-open-trades sau đó.
- plan.md đã ghi rõ tiêu chí: guard phải đứng trước auto-track.

**Action**: chuyển khối guard lên ĐẦU `handleAnalysisResult` (trước vòng
auto-track) ở cả hai file.

## ISSUE-3 (HIGH) — Dòng tuổi nến in thời điểm TƯƠNG LAI

- `telegram-smc.ts:35` / `telegram-volman.ts:28`: `getCandleCloseTime` trả
  `floor(now/interval)*interval + interval` = thời điểm đóng của nến ĐANG CHẠY
  (chưa xảy ra).
- Ví dụ lúc 12:32 UTC, M15: message in `đóng: 12:45 UTC (2 phút trước)` —
  12:45 chưa tới. Số phút thì đúng, mốc giờ sai lệch +1 interval.

**Action**: bỏ `+ intervalMs` — mốc đóng của nến đã đóng gần nhất là
`floor(now/interval)*interval`; `minutesAgo = (now - closeTime)/60000`.
Sửa cả hai file + thêm test cố định mốc thời gian (fake timer) assert đúng
`12:30` chứ không phải `12:45`.

## ISSUE-4 (MEDIUM) — Tuổi nến tính từ đồng hồ lúc gửi, không phải từ nến đã phân tích

- `formatCandleAge` chỉ dựa vào `Date.now()`. Khi analysis được gửi từ CACHE
  (origin.source === "cached" — có thể cách nhiều nến, nhất là manual run với
  latest-cache), dòng này vẫn in "X phút trước" như thể phân tích mới — che
  giấu chính độ trễ mà tính năng sinh ra để phơi bày.
- deliveryContext đã truyền `candleKey` xuống tầng telegram (smc-index.ts:173)
  nhưng không được dùng.

**Action** (chọn 1, ưu tiên a):
a) Truyền candle close ms thật (parse từ candleKey/origin) vào message builder
   và tính tuổi từ đó.
b) Tối thiểu: khi source === "cached", thêm hậu tố `— dữ liệu cache` vào dòng
   tuổi nến.

## Minor (không chặn, fix cùng đợt nếu tiện)

- M1: typo `freshnesReasons` → `freshnessReasons` (4 chỗ, 2 file).
- M2: `signal-freshness.ts` import `TradeSetup` từ `chart-types-smc.js` nhưng
  dùng cho cả Volman qua `as any` (index.ts:224) — định nghĩa type structural
  tối thiểu (pair/direction/entry/stopLoss/takeProfit1/summary) để bỏ cast.
- M3: `getCandleCloseTime`/`formatCandleAge`/`TIMEFRAME_MS` duplicate ở 2 file
  telegram — cân nhắc đưa vào module chung khi sửa ISSUE-3.
- M4: `formatCandleAge` dòng `TIMEFRAME_MS[timeframe || "M15"]` — fallback
  "M15" không bao giờ chạy tới (đã check null trước đó) nhưng gây hiểu nhầm;
  dọn khi sửa ISSUE-3.

## Điều kiện approve vòng sau

1. Reproduction script của ISSUE-1 (setup USD/CAD stale, pair thật) cho ra
   setup BỊ LOẠI với reason rõ ràng.
2. Guard đứng trước auto-track ở cả 2 engine.
3. Test candle-age với fake timer chứng minh mốc giờ là nến ĐÃ đóng.
4. `npm run build` + `npm run test` pass.
