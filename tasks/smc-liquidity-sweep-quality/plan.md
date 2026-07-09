# Plan: SMC Liquidity Sweep Quality Filter

## Bối cảnh

Backtest thật (H4, dữ liệu sống TwelveData, 4 cặp XAU/USD, EUR/USD, GBP/USD, USD/JPY, ~500 nến/cặp, sau khi đã approve [`tasks/smc-correctness-fixes`](../smc-correctness-fixes/done.md)) cho thấy setup `SMC_LIQUIDITY_SWEEP` là setup **yếu nhất** trong hệ thống:

| Cặp | Win rate | Avg R:R |
|---|---|---|
| XAU/USD | 13.6% | -0.50 |
| EUR/USD | 22.6% | -0.23 |
| GBP/USD | 17.8% | -0.36 |
| USD/JPY | 14.8% | -0.48 |

So sánh với 2 setup còn lại (`SMC_BOS_OB` 50-64% WR, `SMC_FVG_CONTINUATION` 69-95% WR), Liquidity Sweep là **setup duy nhất không có bộ lọc chất lượng nào**:

| | BOS/CHOCH+OB | FVG Continuation | Liquidity Sweep |
|---|---|---|---|
| Cần structure xác nhận | ✅ | ✅ (`hasConfirmingStructure`) | ❌ |
| Rejection wick check | ✅ `detectRejectionWick` | ❌ | ❌ |
| RVOL (volume bất thường) | ✅ `calculateRvol` | ❌ | ❌ |
| Ngưỡng độ sâu wick tối thiểu | — | — | ❌ **không có** |

Review phát hiện 2 nguyên nhân cụ thể trong `src/charts/smc/smc-pipeline.ts` (đoạn xử lý sweep, khoảng dòng 284-323):

1. `detectLiquiditySweep` ([smc-structure.ts:174](../../src/charts/smc/smc-structure.ts#L174)) chấp nhận bất kỳ overshoot nào (dù chỉ 0.01%) là sweep hợp lệ — không có ngưỡng độ sâu tối thiểu. Vì swing window rất nhỏ (`left=2, right=2`), sinh ra nhiều swing "vặt", dẫn đến rất nhiều "sweep" chỉ là nhiễu giá bình thường.
2. Setup Sweep hoàn toàn không dùng `detectRejectionWick`/`calculateRvol` (đã có sẵn trong `smc-liquidity-context.ts`, đang dùng cho setup OB) để xác nhận đây là "stop hunt" thật của smart money (nến đuôi dài + volume tăng đột biến) hay chỉ là nhiễu.

## Ràng buộc bắt buộc cho mọi subtask

- **Không sửa `detectLiquiditySweep` trong `smc-structure.ts`** — giữ nguyên hàm phát hiện thuần tuý, để không phá `tests/charts/smc/smc-structure.test.ts` hiện có (2 test case đang assert output chính xác của hàm này). Toàn bộ gating chất lượng làm ở **call site trong `smc-pipeline.ts`**, theo đúng pattern đã dùng cho premium/discount gate ở task trước.
- Không sửa `smc-liquidity-context.ts` (`detectRejectionWick`, `calculateRvol` giữ nguyên) — chỉ gọi lại hàm có sẵn.
- Không đổi 2 setup còn lại (`SMC_BOS_OB`/`SMC_CHOCH_OB`, `SMC_FVG_CONTINUATION`).
- Mỗi subtask phải thêm unit test trong `tests/charts/smc/smc-pipeline.test.ts` chứng minh hành vi trước/sau.
- Sau mỗi subtask: `npm run build && npm test` phải pass, không giảm số test hiện có.
- Chạy tuần tự (01 → 02), cả 2 đều sửa cùng khối code sweep trong `smc-pipeline.ts`.
- Không tự chọn ngưỡng số tuỳ tiện ngoài phạm vi task.md — nếu cần điều chỉnh hệ số, ghi rõ lý do trong `result.md` để Lead review.

## Subtasks

| Subtask ID | Mô tả | Owner | Files chính | Dependency | Output kỳ vọng |
|---|---|---|---|---|---|
| [01-sweep-depth-gate](01-sweep-depth-gate/task.md) | Thêm ngưỡng độ sâu tối thiểu (theo ATR) cho sweep tại call site trong `smc-pipeline.ts` — loại các sweep "nông" dưới ngưỡng | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | none | Sweep có độ sâu < ngưỡng bị loại khỏi candidates, có test chứng minh cả 2 nhánh (đủ sâu / quá nông) |
| [02-rejection-rvol-gate](02-rejection-rvol-gate/task.md) | Áp dụng `detectRejectionWick` + `calculateRvol` để xác nhận chất lượng sweep, phạt hoặc loại khi không đủ điều kiện | worker | `src/charts/smc/smc-pipeline.ts`, `tests/charts/smc/smc-pipeline.test.ts` | 01 | Confidence Sweep phản ánh đúng chất lượng rejection/volume, test cả case đạt/không đạt |

## Rủi ro & lưu ý

- Gate quá gắt có thể làm setup Sweep gần như không bao giờ phát tín hiệu (0 trade) — đây là thay đổi hành vi có chủ đích nhưng cần Lead review kỹ số liệu trước/sau (backtest thật, không chỉ build/test pass) trước khi approve, tương tự cách đã làm với `smc-correctness-fixes`.
- Sau khi cả 2 subtask xong, Lead sẽ tự chạy lại backtest thật (cùng phương pháp: cache dữ liệu 1 lần, so sánh code trước/sau) để verify win rate Sweep có cải thiện thật hay không — không chỉ dựa vào unit test.
- Nếu sau gate mà Sweep vẫn xấu rõ rệt so với 2 setup kia, cân nhắc hạ trọng số/loại hẳn setup này khỏi `analyzeSmcWindow` — nhưng đó là quyết định của Lead sau khi có số liệu, không phải việc của Worker ở task này.
