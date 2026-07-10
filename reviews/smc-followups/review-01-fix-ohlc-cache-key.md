# Lead Review — 01-fix-ohlc-cache-key

Verdict: **APPROVED**
Ngày: 2026-07-10

## Đối chiếu task.md

- `fetchOhlcHistory` thêm đúng tham số thứ 4 `options?: { bypassCache?: boolean }`, không đổi `cacheKey()`. ✅
- Cả 3 chỗ dùng cache (in-memory read, persisted read, write) đều thêm điều kiện `!bypassCache` đúng vị trí. ✅
- `smc-backtest-runner.ts` truyền `{ bypassCache: true }` ở cả 2 lời gọi `fetchOhlcHistory` (LTF + HTF). ✅
- Không đụng file nào ngoài 2 file cho phép. ✅
- Backward compatible: `smc-pipeline.ts` (luồng live) gọi `fetchOhlcHistory` với 3 tham số — không truyền `options` nên `bypassCache` mặc định `false`, giữ nguyên hành vi cache cũ. Worker đã tự kiểm tra và ghi trong result.md — Lead xác nhận đúng. ✅

## Lead tự verify

- `npm run build`: pass.
- `npm run test`: 753/753 pass.
- Đối chiếu diff thực tế khớp 100% với mô tả trong result.md, không có thay đổi thừa.
- Chấp nhận bằng chứng bypassCache hoạt động: 2 lần chạy `BACKTEST_BARS=300` vs `600` cho kết quả khác nhau rõ rệt (signals 1069 → 2182, trades 432 → 894) — đúng là bằng chứng cache không còn bị trộn.

## Kết luận

Task 01 sạch, không deviation. Sẵn sàng cho Worker làm Task 02 (pin-backtest-window, phụ thuộc 01) và Task 03 (log-setup-grade-breakdown, độc lập, có thể làm song song).
