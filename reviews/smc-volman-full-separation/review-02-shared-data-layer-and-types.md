# Review — Subtask 02: Shared Data Layer & Type Splitting

**Kết luận:** CHANGES_REQUIRED (nhỏ) — không tạo `done.md`.

## Cập nhật (2026-07-10, sau khi Worker hoàn thành Step 6b)

Worker đã tạo `analyzer-common.ts`/`analyzer-volman.ts` đúng cấu trúc Step 6b điểm 1-4: import `TradeSetup`/
`PairSummary` từ `chart-types-volman.js`, `PendingOrder` từ `chart-types-common.js` (verify bằng Read trực tiếp cả 2
file); không đụng `signal-assembly.ts`; không xoá `analyzer.ts` gốc; build + test pass (809 tests).

**Vấn đề còn lại — Step 6b điểm 5 bị bỏ qua:** task.md yêu cầu rõ *"Viết test tối thiểu cho `analyzer-common.ts` và
`analyzer-volman.ts` dưới `tests/charts/`"*. Verify: `Glob tests/charts/analyzer*` chỉ trả về `analyzer.test.ts` cũ,
không có test nào cho 2 file mới. `result.md` của Worker diễn giải sai yêu cầu này thành "No new test files created
(per task instructions — minimal testing)" — task.md không nói bỏ qua test, mà yêu cầu viết test **tối thiểu**.

## Hành động cần Worker fix

Viết test tối thiểu cho `analyzer-common.ts` (4 hàm: `buildChartAnalysisCacheKey`, `cleanResponse`,
`extractJsonObject`, `clampConfidence`) và `analyzer-volman.ts` (ít nhất `formatPrice`, `applyPriceSanityChecks`,
`parseAnalysisResponse` — 3 hàm public quan trọng nhất) dưới `tests/charts/analyzer-common.test.ts` và
`tests/charts/analyzer-volman.test.ts`, copy pattern từ `tests/charts/analyzer.test.ts` hiện có. Chạy lại
`npm run build && npm run test`, cập nhật `result.md`.

---

## (Giữ nguyên nội dung review gốc bên dưới để tham khảo lịch sử)

## Cập nhật (2026-07-10, sau đối chiếu 2 lần review độc lập)

Vấn đề "PendingOrder/PendingOrderStatus đặt sai vị trí" đã được **giải quyết bằng quyết định kiến trúc**: giữ 2 type
này (cùng `ChartTimeframe`, `CandleRangeStats`) trong `chart-types-common.ts` vì field giống hệt nhau ở cả 2 hệ,
không có nghiệp vụ khác biệt. Quyết định đã ghi vào `plan.md` §1. Các subtask 04/05/07 đã import đúng
`./chart-types-common.js` cho các type này (verify lại bằng Grep trực tiếp, xem `04-split-position-engine/done.md`,
`05-split-positions-repository/done.md`, `07-split-position-decision-and-check-runners/done.md`) — không còn là
vấn đề chặn task 10.

**Vấn đề duy nhất còn lại — Thiếu hoàn toàn bước tách `analyzer.ts` (Step 6b trong task.md)**

`tasks/smc-volman-full-separation/02-shared-data-layer-and-types/task.md` mục "Step 6b (bổ sung sau Lead self-review
2026-07-10): Split `analyzer.ts`" yêu cầu tạo:
- `src/charts/analyzer-common.ts`
- `src/charts/analyzer-volman.ts`

**Verify (Glob):** `src/charts/analyzer*.ts` → chỉ có `analyzer.ts` gốc, cả 2 file trên **không tồn tại**. `result.md`
của Worker không nhắc gì tới bước này.

## Hành động cần Worker fix

Thực hiện đúng Step 6b trong task.md — tạo `analyzer-common.ts` (chứa `buildChartAnalysisCacheKey`, `cleanResponse`,
`extractJsonObject`, `clampConfidence`) và `analyzer-volman.ts` (chứa `applyPriceSanityChecks`, `formatPrice`,
`parseAnalysisResponse`, `buildPendingOrderCheckPrompt`, `parsePendingOrderCheckResponse` + helper private, import
`TradeSetup`/`PairSummary`/`PendingOrder` từ `./chart-types-volman.js` + `./chart-types-common.js`). Không sửa
`signal-assembly.ts` (việc của task 10). Cập nhật `result.md` với evidence (2 file mới + build/test pass).

## Việc đã đúng (không cần sửa)

- `chart-types-common.ts`, `chart-types-volman.ts`, `chart-types-smc.ts` tồn tại, nội dung field cơ bản khớp bản gốc.
- `PendingOrder`/`PendingOrderStatus` ở `chart-types-common.ts` — đúng quyết định kiến trúc cuối cùng (xem trên).
- `docs/volman-numeric-engine.md` đã sửa MetaApi → TwelveData (verify: dòng 26 hiện đúng).
- `ohlc-provider.ts`/`ohlc-cache-repository.ts` không bị đổi.
