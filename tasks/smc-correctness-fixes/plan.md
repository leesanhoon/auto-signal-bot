# Plan: SMC Entry-Rule Correctness Fixes

## Bối cảnh

Review thủ công `src/charts/smc/` (structure detection, pipeline, liquidity context) so với chuẩn entry SMC/ICT phổ biến phát hiện 5 vấn đề cụ thể, đều nằm trong `src/charts/smc/smc-pipeline.ts`:

1. **Bug logic hướng ở setup FVG_CONTINUATION** ([smc-pipeline.ts:239](../../src/charts/smc/smc-pipeline.ts#L239)): gọi `detectStructureBreak(scopedCandles, swings, index, dir)` rồi chỉ check `structure ? 74 : 60` — không verify `structure.direction === dir`. `previousBias` chỉ ảnh hưởng nhãn BOS/CHOCH, không lọc hướng. Kết quả: có thể tăng confidence 74 dù structure event xác nhận lại là hướng ngược với FVG.
2. **SL của setup BOS/CHOCH+OB không có buffer** ([smc-pipeline.ts:144](../../src/charts/smc/smc-pipeline.ts#L144)): `stopLoss = ob.low`/`ob.high` thẳng, trong khi 2 setup còn lại (`SMC_LIQUIDITY_SWEEP`, `SMC_FVG_CONTINUATION`) đều có `stopBuffer` dựa ATR. Dễ bị wick/spread quét SL sát biên OB.
3. **Premium/Discount zone tính nhưng không gate entry** ([smc-pipeline.ts:139](../../src/charts/smc/smc-pipeline.ts#L139), [:187](../../src/charts/smc/smc-pipeline.ts#L187)): chuẩn SMC yêu cầu chỉ LONG từ discount, chỉ SHORT từ premium. Hiện `pdZone` chỉ lưu để hiển thị, không loại/hạ điểm setup sai zone.
4. **TP không nhắm liquidity pool thực tế** ([smc-pipeline.ts:150-166](../../src/charts/smc/smc-pipeline.ts#L150-L166)): `equalLevels`/`priorWeekHigh/Low` được tính và gắn vào `liquidityTargets` nhưng TP1/TP2 vẫn luôn là bội số R cố định (2R/3R), không dùng liquidity target gần nhất khi nó nằm gần hơn TP mặc định.
5. **Không gate theo killzone/session** ([smc-pipeline.ts:193](../../src/charts/smc/smc-pipeline.ts#L193), [:230](../../src/charts/smc/smc-pipeline.ts#L230), [:266](../../src/charts/smc/smc-pipeline.ts#L266)): `detectSession` được gọi và gắn vào signal nhưng không có điều kiện hạ/loại setup ngoài killzone London/NY overlap.

## Ràng buộc bắt buộc cho mọi subtask

- Đây là sửa lỗi/logic đúng chuẩn SMC — **không đổi kiến trúc, không đổi tên export public** trừ khi task.md yêu cầu rõ.
- Không đổi 3 file domain khác (`betting`, `lottery`) hay layer khác ngoài `src/charts/smc/*` và `tests/charts/smc/*`.
- Mỗi subtask phải thêm/sửa unit test tương ứng trong `tests/charts/smc/` chứng minh hành vi cũ (bug) và hành vi mới (đã fix) — không chỉ sửa code mà không có test.
- Sau mỗi subtask: `npm run build && npm test` phải pass, không giảm số test hiện có.
- Chạy tuần tự (01 → 02 → 03 → 04 → 05), không song song, vì tất cả đều sửa `smc-pipeline.ts` — tránh xung đột merge.
- Worker không tự thêm setup mới, không đổi ngưỡng confidence/grade ngoài phạm vi task.md.

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-fvg-direction-bug](01-fvg-direction-bug/task.md) | Fix bug: `SMC_FVG_CONTINUATION` phải chỉ tăng confidence 74 khi `structure.direction === fvg.direction` thực sự | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | none | Confidence chỉ tăng khi structure cùng hướng FVG, có test case chứng minh cả 2 nhánh |
| [02-ob-stop-buffer](02-ob-stop-buffer/task.md) | Thêm ATR buffer cho SL của setup `SMC_BOS_OB`/`SMC_CHOCH_OB`, đồng nhất với 2 setup còn lại | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 01 | SL setup OB có buffer, risk/TP tính lại theo SL mới, test cập nhật |
| [03-premium-discount-gate](03-premium-discount-gate/task.md) | Gate entry theo premium/discount: loại hoặc hạ confidence nếu LONG ở premium / SHORT ở discount cho các setup có `premiumDiscountZone` | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 02 | Setup sai zone bị loại hoặc hạ điểm rõ ràng, test cả 2 trường hợp đúng/sai zone |
| [04-liquidity-target-tp](04-liquidity-target-tp/task.md) | Khi có `liquidityTargets` gần hơn TP mặc định (2R/3R) theo đúng hướng, dùng target đó làm TP thay vì R cố định | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 03 | TP ưu tiên liquidity pool thực tế khi hợp lệ, fallback về R cố định khi không có target phù hợp, test cả 2 nhánh |
| [05-session-killzone-gate](05-session-killzone-gate/task.md) | Hạ confidence hoặc loại setup phát sinh ngoài killzone (London/NY overlap) theo session đã detect | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 04 | Setup ngoài killzone bị hạ điểm/loại theo rule rõ ràng, test theo giờ trong/ngoài killzone |

## Rủi ro & lưu ý

- `detectStructureBreak` hiện không nhận filter theo hướng — subtask 01 chỉ sửa ở call site trong pipeline, **không đổi signature/behavior của `detectStructureBreak` trong `smc-structure.ts`** để không phá test hiện có của `smc-structure.test.ts`.
- Subtask 03 (premium/discount gate) có thể làm giảm mạnh số lượng setup phát ra — đây là thay đổi hành vi có chủ đích (đúng chuẩn SMC), cần Lead review kỹ so với `plan.md` trước khi approve, không chỉ dựa vào build/test pass.
- Subtask 04 cần đảm bảo không đặt TP gần hơn SL (tối thiểu phải xa hơn entry theo đúng hướng), tránh risk/reward âm hoặc bằng 0.
- Subtask 05 dùng lại `detectSession`/`smc-session.ts` đã có sẵn — không viết lại logic session mới.
