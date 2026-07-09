# Plan: Tắt hẳn setup SMC_LIQUIDITY_SWEEP

## Bối cảnh

Qua 3 vòng backtest thật độc lập (dữ liệu sống, nhiều cặp, nhiều mode: có/không premium-discount gate, có/không sweep-quality gate, static-HTF, rolling-HTF — xem [`smc-liquidity-sweep-quality/review.md`](../smc-liquidity-sweep-quality/review.md) và [`smc-rolling-htf-backtest/review.md`](../smc-rolling-htf-backtest/review.md)), setup `SMC_LIQUIDITY_SWEEP` **luôn là setup tệ nhất**, nhất quán ở mọi cặp và mọi vòng:

| Vòng backtest | Win rate Sweep (dải qua 4 cặp) | Avg R:R |
|---|---|---|
| Sau depth+rejection+RVOL gate | 5.9% – 30% | -0.1 đến -0.82 (luôn âm) |
| Rolling HTF (vòng gần nhất) | 12.5% – 30% | -0.1 đến -0.57 (luôn âm) |

So sánh: `SMC_BOS_OB` (50-67%), `SMC_FVG_CONTINUATION` (75-96%) đều dương và ổn định. Đã thử 2 lớp lọc chất lượng (độ sâu sweep theo ATR, rejection wick + RVOL) nhưng không cải thiện được — nghi vấn nằm ở chính công thức SL/TP của setup này (SL = `sweptLevel ± buffer`, TP = R cố định), không phải do thiếu bộ lọc đầu vào. Quyết định: **tắt hẳn**, không tiếp tục đổ công sức vá thêm.

## Mục tiêu

Loại bỏ hoàn toàn việc setup `SMC_LIQUIDITY_SWEEP` tạo ra tín hiệu giao dịch trong pipeline — **không dùng feature flag/config bật-tắt**, xoá thẳng đoạn code build signal cho setup này (đúng theo nguyên tắc dự án: không thêm cờ cấu hình khi có thể sửa code trực tiếp).

## Phạm vi — CHỈ xoá phần "biến sweep thành signal giao dịch" trong pipeline

- **Giữ nguyên hoàn toàn** `detectLiquiditySweep` trong `smc-structure.ts` và toàn bộ `tests/charts/smc/smc-structure.test.ts` — đây là hàm phát hiện thuần tuý (primitive), không phải bản thân "setup giao dịch". Không xoá, để nếu sau này muốn dùng lại (ví dụ chỉ làm tín hiệu xác nhận phụ, không phải setup độc lập) thì hàm gốc vẫn còn nguyên.
- **Không sửa** `smc-types.ts` (giữ nguyên `"SMC_LIQUIDITY_SWEEP"` trong union `SmcSetupName`, giữ field `liquiditySweep?`) — các field này optional, không gây lỗi gì khi không còn được gán, xoá sẽ kéo theo sửa dây chuyền nhiều file khác không cần thiết (`smc-signal-assembly.ts`, `smc-backtest.ts` đều có check `if (signal.liquiditySweep)` — vẫn hoạt động đúng, chỉ đơn giản không bao giờ true nữa).
- **Không sửa** `smc-liquidity-context.ts`, `smc-session.ts`, `smc-confluence.ts`, `smc-htf-context.ts`.
- **Chỉ sửa** `src/charts/smc/smc-pipeline.ts`: xoá đoạn code trong `buildSmcCandidatesAtIndex` build ra `CandidateSource` cho `SMC_LIQUIDITY_SWEEP`, xoá import `detectLiquiditySweep` không còn dùng, xoá helper `createEntryZone` (chỉ dùng riêng cho sweep, sẽ thành dead code nếu không xoá).
- **Chỉ sửa** `tests/charts/smc/smc-pipeline.test.ts`: xoá các test case chỉ kiểm tra hành vi setup Sweep (không còn ý nghĩa vì setup không tồn tại), giữ/điều chỉnh test case nào đang xác nhận **hành vi của setup khác** (OB/FVG) không bị ảnh hưởng.

## Ràng buộc bắt buộc

- Sau khi xoá, `npm run build` không được còn cảnh báo/lỗi unused import/unused function.
- `npm test` pass, số test **giảm có chủ đích** (xoá test case không còn áp dụng được) — phải liệt kê rõ từng test bị xoá và lý do trong `result.md`, không được xoá âm thầm.
- Không dùng `return` sớm thoát cả hàm `buildSmcCandidatesAtIndex` khi xoá khối sweep (bài học lặp lại từ các task trước) — thực chất subtask này **xoá hẳn khối `if (sweep) {...}` cùng dòng `const sweep = ...`**, không phải thêm điều kiện, nên rủi ro này không áp dụng trực tiếp nhưng vẫn cần đọc kỹ để không vô tình xoá nhầm code của OB/FVG nằm liền kề.
- Không đổi hành vi/logic của setup `SMC_BOS_OB`/`SMC_CHOCH_OB`/`SMC_FVG_CONTINUATION`.

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-remove-sweep-setup](01-remove-sweep-setup/task.md) | Xoá khối build signal Sweep khỏi `smc-pipeline.ts`, dọn import/helper thừa, xoá/điều chỉnh test tương ứng | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | none | Setup Sweep không còn xuất hiện trong bất kỳ candidates nào, build sạch không unused code, test pass với số lượng giảm có giải thích rõ |

## Rủi ro & lưu ý

- Sau khi approve, Lead sẽ chạy lại backtest thật (không cần Sweep nữa) để xác nhận: (a) tổng win rate/avg R:R không giảm so với khi còn Sweep (kỳ vọng tăng nhẹ vì loại bỏ phần âm), (b) không có lỗi runtime nào khi Sweep signal không bao giờ xuất hiện (ví dụ `analyzeSmcWindow` vẫn hoạt động bình thường khi candidates chỉ còn OB/FVG).
- `smc-backtest-runner.ts`/`smc-backtest.ts` không cần sửa gì — chúng không biết/không quan tâm có bao nhiêu loại setup, chỉ xử lý candidates chung.
