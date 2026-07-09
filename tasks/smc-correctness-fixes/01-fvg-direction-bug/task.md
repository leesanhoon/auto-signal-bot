# Task 01: Fix FVG Direction Confirmation Bug

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc, chứa bối cảnh đầy đủ và ràng buộc chung.

## Mục tiêu

Sửa bug trong setup `SMC_FVG_CONTINUATION`: hiện tại code tăng confidence lên 74 chỉ vì `detectStructureBreak(...)` trả về một event (bất kỳ hướng nào), không kiểm tra event đó có thực sự **cùng hướng** với FVG hay không.

## Vị trí lỗi

`src/charts/smc/smc-pipeline.ts`, trong `buildSmcCandidatesAtIndex`, đoạn xử lý FVG (khoảng dòng 236-270):

```ts
const fvg = detectFairValueGap(scopedCandles, index);
if (fvg) {
  const dir = fvg.direction;
  const structure = detectStructureBreak(scopedCandles, swings, index, dir);
  // ...
  confidence: structure ? 74 : 60,
  grade: structure ? "B" : "C",
  score: structure ? 74 : 60,
  ruleTrace: ["FVG cùng hướng cấu trúc đang mở rộng."],
  structureEvent: structure ?? undefined,
```

`detectStructureBreak` (trong `smc-structure.ts`) tự xác định `direction` dựa trên so sánh giá đóng cửa với swing HIGH/LOW gần nhất — tham số `previousBias` (đang truyền `dir` vào) **chỉ** dùng để phân loại BOS vs CHOCH, KHÔNG lọc theo hướng. Vì vậy `structure` có thể trả về khác hướng với `dir`, nhưng code vẫn coi truthy `structure` là "cùng hướng cấu trúc" — sai với ruleTrace đang mô tả.

## Việc cần làm

1. Trong đoạn xử lý FVG ở `buildSmcCandidatesAtIndex`, sau khi gọi `detectStructureBreak`, thêm điều kiện kiểm tra rõ ràng: chỉ coi là "có xác nhận cấu trúc cùng hướng" khi `structure !== null && structure.direction === dir`.
2. Dùng biến boolean riêng (ví dụ `hasConfirmingStructure`) thay vì dựa vào `structure` truthy trực tiếp, để gán `confidence`/`grade`/`score`/`ruleTrace`:
   - `hasConfirmingStructure === true` → confidence 74, grade "B", score 74, ruleTrace `["FVG cùng hướng cấu trúc đang mở rộng."]`.
   - `hasConfirmingStructure === false` → confidence 60, grade "C", score 60, ruleTrace giữ nguyên logic cũ cho trường hợp không xác nhận (có thể tái dùng string hiện có hoặc thêm câu phù hợp, miễn không claim "cùng hướng cấu trúc" khi không đúng).
3. Trường `structureEvent: structure ?? undefined` trong `opts` của `buildSignal`: giữ nguyên gán `structure` nếu có (kể cả khi khác hướng) — đây là dữ liệu tham khảo, KHÔNG phải chỗ gây bug. Chỉ sửa phần quyết định confidence/grade/score/ruleTrace.
4. **Không đổi** `detectStructureBreak` trong `smc-structure.ts` — không đổi signature, không đổi behavior, để không phá `tests/charts/smc/smc-structure.test.ts` hiện có.
5. **Không đổi** setup `SMC_BOS_OB`/`SMC_CHOCH_OB`/`SMC_LIQUIDITY_SWEEP` trong subtask này.

## Việc KHÔNG được làm

- Không đổi logic của 2 setup còn lại (BOS/CHOCH+OB, Liquidity Sweep).
- Không đổi `smc-structure.ts`, `smc-liquidity-context.ts`, `smc-session.ts`, `smc-confluence.ts`, `smc-signal-assembly.ts`.
- Không đổi ngưỡng confidence/grade cho các trường hợp khác ngoài FVG.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Test case dựng dữ liệu nến sao cho FVG bullish (`dir = LONG`) xuất hiện, và `detectStructureBreak` tại cùng index trả về structure event **hướng SHORT** (ngược `dir`) → assert confidence phải là 60 (KHÔNG phải 74), grade "C".
2. Test case dựng dữ liệu nến sao cho FVG cùng hướng với structure event thật (`dir = LONG` và structure trả về `direction: "LONG"`) → assert confidence là 74, grade "B" (hành vi giữ nguyên đúng như thiết kế ban đầu).
3. Nếu test hiện có (`smc-pipeline.test.ts`) đã có case cho FVG mà đang ngầm dựa vào bug (giả sử bất kỳ structure nào cũng đủ), rà soát và sửa lại assertion cho đúng theo hành vi mới.

## Acceptance Criteria

- `npm run build` pass, không lỗi type.
- `npm test` pass, số test tăng (thêm ít nhất 2 case mới ở trên), không có test nào bị xoá mà không giải thích trong `result.md`.
- Đọc lại đoạn code đã sửa, xác nhận: confidence 74 chỉ được gán khi `structure.direction === dir` thật sự đúng.

## Kết quả cần ghi vào `result.md`

- Diff/đoạn code trước–sau ở `smc-pipeline.ts`.
- Danh sách test case đã thêm, kèm giải thích ngắn từng case verify điều gì.
- Output `npm run build` và `npm test` (số test pass trước/sau).
- Nếu bị chặn → ghi `blocked.md`, không tự ý đổi cách tiếp cận khác mà không ghi rõ lý do.
