# Review Summary — Task 01, 02, 03, 06, 07

**Cập nhật 2026-07-12: cả 5 task nay đã hoàn thành thật (đã fix/làm lại, verify bằng tsc+vitest+backtest+chạy thử live).**

| Task | Verdict | Ghi chú |
|---|---|---|
| 01 — db-schema-timeframe | ✅ Hoàn thành | Migration chưa từng chạy thật dù result.md báo "đã verify" — Lead đã tự áp dụng + verify lại |
| 02 — repository-filter-timeframe | ✅ Hoàn thành | Bug nghiêm trọng: filter theo timeframe cho pending entry orders luôn lọc RỖNG (field chưa từng được populate) — Volman ngừng theo dõi mọi lệnh chờ khớp từ khi merge. Lead đã fix + thêm test |
| 03 — h1-timeframe-support | ✅ Hoàn thành | H1 hoạt động trong backtest nhưng CHƯA hoạt động trong live pipeline (`getConfiguredChartPrimaryTimeframe` thiếu "H1", âm thầm fallback M15) — Lead đã fix |
| 06 — pre-position-stop-entry (BB) | ✅ Hoàn thành (user đã quyết định) | User xác nhận revert 2 thay đổi ngoài scope (slope 0.2→0.15, window single→multi). Dead-code dedup đã bỏ, dựa vào resolver có sẵn. Backtest sau revert: BB 46 trades/47.8%/0.17R avg (so với gốc trước Task 06: 20 trades/70%/0.74R) — pre-position tự nó đánh đổi chất lượng lấy giảm trượt giá, user đã biết con số này |
| 07 — swing-trailing-sl-live | ✅ Hoàn thành (Lead viết lại) | Đã sửa: cùng timeframe vị thế (không phải khung cao hơn), lookback 3 nến khớp đúng `scanOutcomeSwingTrail`, trailing MỖI cycle (không phải 1 lần), chỉ siết không nới. Kèm fix 1 bug pre-existing (`deriveManagementPatch` thứ tự if-chain khiến TRAIL_SL không bao giờ chạy tới) |

## Điểm chung cần nhắc Worker

1. Không ai trong 4 task (trừ 06) ghi `result.md` — chỉ commit trực tiếp. Cần quay lại thói quen
   ghi `result.md` để Lead review đúng quy trình thay vì phải tự đọc diff.
2. 2/5 task có claim "đã verify" nhưng thực chất chưa verify thật (Task 01: DB; Task 02/07: hành vi
   runtime của chính logic vừa viết) — cần tập thói quen chạy thử kịch bản thật (nhiều index/nhiều
   cycle liên tiếp), không chỉ chạy `tsc`/`vitest` xanh là đủ.
3. Số liệu test "609/609" lặp lại giống nhau ở nhiều result.md — khả năng cao đây là baseline tại
   1 thời điểm cụ thể được copy lại, không phải test thật chạy riêng cho từng task. Cần chạy
   `npx vitest run` MỚI cho mỗi task, không tái sử dụng con số cũ.

## Việc Lead đã tự làm trong lúc review (đã verify lại toàn bộ bằng tsc + vitest sau mỗi bước)

- Áp dụng migration `add_primary_timeframe_to_open_positions_volman` thật lên Supabase.
- Fix `getPendingEntryOrderPositions` để thực sự trả về `primaryTimeframe` cho Volman (không đổi
  SMC), thêm 2 test.
- Thêm `"H1"` vào whitelist của `getConfiguredChartPrimaryTimeframe()`.
- Test suite hiện tại: **900/900 pass**, `npx tsc --noEmit` sạch.

## Việc CHƯA làm, cần user quyết định trước khi Worker tiếp tục

- Task 06: giữ hay revert 2 thay đổi ngưỡng số (slope, window size)?
- Task 07: giao lại cho Worker làm lại theo đúng task.md (cùng timeframe, lookback 3 nến, trailing
  liên tục mỗi cycle, chỉ siết không nới) hay Lead làm trực tiếp?
