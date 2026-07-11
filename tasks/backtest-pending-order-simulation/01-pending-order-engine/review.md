# Review — 01-pending-order-engine

## Verdict: APPROVED

## Checklist

1. **Immediate mode giữ nguyên 100% hành vi cũ**
   `git diff -- src/charts/setup-backtest.ts` cho thấy toàn bộ nhánh
   `fillMode === "immediate"` chạy đúng đoạn code gốc, chỉ được bọc thêm điều kiện
   `fillMode === "immediate"` (setup-backtest.ts:161) hoặc `else` (setup-backtest.ts:225-239)
   — không có thay đổi logic bên trong. `buildTrade` giữ `entryIndex = entryIndexOverride ?? signal.triggerIndex`
   (setup-backtest.ts:257) nên mọi call site cũ (không truyền `entryIndexOverride`)
   vẫn dùng `signal.triggerIndex` y hệt trước. Tất cả call site hiện có trong repo
   (`tests/charts/setup-backtest.test.ts`, `tests/charts/setup-backtest-queue.test.ts`,
   `src/charts/setup-backtest-runner.ts:131`) chỉ truyền 3 tham số vị trí đầu, không
   bị ảnh hưởng bởi 2 tham số mới. Đạt.

2. **Thứ tự ưu tiên invalidation trước trigger**
   setup-backtest.ts:138-159: khối `if (fillMode === "pending" ...)` kiểm tra
   `invalidated` trước (`low <= stopLoss` cho LONG / `high >= stopLoss` cho SHORT,
   dòng 142), chỉ khi KHÔNG invalidated mới xét `triggered` (dòng 147) trong nhánh
   `else`. Trường hợp cùng nến vừa chạm SL vừa chạm entry sẽ luôn rơi vào nhánh
   `invalidated` trước do cấu trúc `if/else`, khớp đúng
   `resolvePendingOrderDecision` (kiểm tra SL trước khi kiểm tra trigger). Đạt —
   đây là điểm quan trọng nhất và implement đúng.

3. **Expiry sau N nến**
   `deadlineIndex = signal.triggerIndex + pendingExpiryBars` (setup-backtest.ts:223),
   `orderStartIndex = signal.triggerIndex + 1` (dòng 222). Với `pendingExpiryBars = 2`
   (default), order được check tại `index = triggerIndex+1` và `triggerIndex+2`, hết
   hạn tại `index >= deadlineIndex` (dòng 154) tức đúng ở lần check thứ 2. Đối chiếu
   `check-pending-orders-runner-volman.ts:127` (`nextRunCount >= order.expiryRuns`,
   `nextRunCount = order.runCount + 1`) — live cũng hết hạn ở lần check thứ 2 khi
   `expiryRuns = 2` (default `PENDING_ORDER_EXPIRY_RUNS`). Khớp đúng, và đây đã được
   plan ghi rõ là xấp xỉ hợp lý ("Rủi ro / Edge cases" mục 2). Đạt.

4. **pendingStats cộng dồn**
   `signalsSeen++` mỗi khi tạo pending order mới (dòng 218). Mỗi pending order được
   tạo sẽ resolve về đúng 1 trong 3 nhánh: `filled` (dòng 151), `cancelledBeforeFill`
   (dòng 144), `expired` (dòng 155) — trừ trường hợp còn dở dang khi hết dữ liệu
   candles (không cộng vào đâu cả), đúng theo edge case đã ghi rõ trong plan.md
   ("Rủi ro / Edge cases" mục 1). Không có double-counting: mỗi bar chỉ xử lý tối đa
   1 pending order (`pendingOrder = null` ngay sau khi resolve). Đạt.

5. **Build & test**
   `npm run build` → 0 lỗi TypeScript (tsc pass).
   `npx vitest run tests/charts/setup-backtest.test.ts` → 6/6 tests pass, khớp claim
   của Worker trong result.md.

## Ghi chú thêm

- Tất cả call site hiện có trong codebase (kể cả `setup-backtest-queue.test.ts` mà
  result.md không nhắc tới) đều không bị ảnh hưởng — đã verify bằng grep toàn repo.
- Không phát hiện regression nào ở immediate mode; không phát hiện sai thứ tự
  invalidation/trigger; expiry logic khớp với live.

Subtask 01-pending-order-engine đạt yêu cầu plan.md + task.md. Không cần Worker
fix gì thêm.
