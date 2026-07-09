# Done: SMC Correctness Fixes

Tất cả 5 subtask (01-05) đã approved theo [`review.md`](review.md), round 2.

## Tóm tắt thay đổi (chỉ `src/charts/smc/smc-pipeline.ts` + `tests/charts/smc/smc-pipeline.test.ts`)

1. Fix bug confidence FVG_CONTINUATION tăng sai khi structure event ngược hướng.
2. Thêm ATR buffer cho SL của setup BOS/CHOCH+OB (đồng nhất với Liquidity Sweep/FVG).
3. Gate confidence theo premium/discount zone cho setup OB (phạt -15 khi sai zone).
4. TP2/TP3 ưu tiên liquidity pool thực tế (equal level, prior week level) khi hợp lệ, fallback về 2R/3R.
5. Phạt confidence theo session/killzone (ASIA -5, OFF_HOURS -10) cho cả 3 setup.

## Verify cuối cùng (Lead, độc lập với báo cáo Worker)

- `npm run build` → pass, không lỗi type.
- `npm test` (toàn repo) → Test Files 64 passed (64), Tests 673 passed (673).
- Không còn dead code / finding mở nào từ review round 2.

## Không trong scope (đã note trong plan.md, có thể làm task riêng sau nếu cần)

- Premium/discount gate và liquidity-target TP hiện chỉ áp dụng cho setup BOS/CHOCH+OB, chưa áp dụng cho Liquidity Sweep/FVG Continuation.
- Score BOS đúng zone giữ ở 80 (không phải 84 như code gốc trước khi có subtask 03) — chấp nhận được vì grade không đổi, đã ghi rõ trong `review.md`.
