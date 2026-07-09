# Task 03: HTF Directional Hard Gate

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc, đặc biệt phần "Bài học từ lỗi ở task trước". **Chạy sau khi subtask 02 đã approved.**

## Mục tiêu

Đây là quy tắc cốt lõi nhất của SMC top-down: **chỉ vào lệnh cùng hướng với bias khung thời gian lớn hơn**. Khi `htfContext.bias` xác định được (không null) và ngược hướng với setup LTF đang xét → loại hẳn signal đó khỏi candidates (không chỉ hạ điểm như premium/discount gate ở task trước).

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`, cả 3 khối xử lý setup trong `buildSmcCandidatesAtIndex` (đã nhận tham số `htfContext` từ subtask 02):

1. **OB** (khoảng dòng 176-281): direction = `structure.direction`.
2. **Sweep** (khoảng dòng 283-343): direction = `sweep.direction`. **Lưu ý:** khối này đã có gate `isSweepTooShallow` từ task trước, bọc bằng `if (!isSweepTooShallow) { ... }` — gate HTF mới phải kết hợp đúng với gate đã có, KHÔNG được viết `return` (xem cảnh báo trong `plan.md`).
3. **FVG** (khoảng dòng 345+): direction = `dir` (= `fvg.direction`).

## Việc cần làm

1. Viết 1 hàm dùng chung (đặt ở đầu file, gần các hàm helper khác như `sessionConfidencePenalty`):

```ts
function isAgainstHtfBias(htfContext: HtfContext | null | undefined, direction: SmcDirection): boolean {
  return htfContext?.bias !== null && htfContext?.bias !== undefined && htfContext.bias !== direction;
}
```

2. Trong mỗi khối xử lý setup, **ngay sau khi xác định được `direction`** (và sau gate độ sâu sweep đã có ở khối Sweep — tức là lồng logic mới vào trong cùng, không phá cấu trúc `if (!isSweepTooShallow) {...}` hiện có), thêm điều kiện:

```ts
if (isAgainstHtfBias(htfContext, direction)) {
  // bỏ qua, không tạo signal cho setup này — KHÔNG return khỏi hàm
} else {
  // ... toàn bộ logic build signal hiện có của khối này
}
```

   Cụ thể cho từng khối:
   - **OB**: bọc toàn bộ phần từ `const pdZone = ...` (sau khi đã có subtask 02) đến `candidates.push(...)` trong `if (!isAgainstHtfBias(htfContext, structure.direction)) { ... }`.
   - **Sweep**: bên trong `if (!isSweepTooShallow) { ... }` đã có, thêm 1 lớp nữa `if (!isAgainstHtfBias(htfContext, direction)) { ... }` bọc phần còn lại (rejection/rvol check, sessionAdjusted, signal, push).
   - **FVG**: bọc toàn bộ phần từ `const structure = detectStructureBreak(...)` (sau khi đã tính `dir`) đến `candidates.push(...)` trong `if (!isAgainstHtfBias(htfContext, dir)) { ... }`.
3. Khi `htfContext` là `null`/`undefined`, hoặc `htfContext.bias` là `null` (không xác định được bias) → `isAgainstHtfBias` luôn trả `false` → **không gate gì cả**, giữ nguyên hành vi cũ hoàn toàn.

## Việc KHÔNG được làm

- **TUYỆT ĐỐI không dùng `return candidates;` hoặc `return` bất kỳ dạng nào để thoát khỏi gate** — đây chính là bug đã xảy ra ở task trước (xem [review đã ghi](../../smc-liquidity-sweep-quality/review.md)). Phải dùng `if/else` bọc logic, không return sớm khỏi `buildSmcCandidatesAtIndex`.
- Không gate mềm (không hạ điểm một phần) — chỉ có 2 trạng thái: loại hẳn (ngược bias) hoặc giữ nguyên y hệt cũ (cùng bias hoặc không xác định).
- Không đổi cách tính premium/discount đã wire ở subtask 02.
- Không đổi gate độ sâu sweep hay rejection/RVOL gate đã có.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Mock BOS LONG hợp lệ (qua hết các gate khác) + `htfContext = { bias: "SHORT", ... }` → assert **không có** signal `SMC_BOS_OB` nào trong candidates.
2. Mock BOS LONG hợp lệ + `htfContext = { bias: "LONG", ... }` → assert vẫn có signal, confidence không đổi so với không có HTF gate (gate không ảnh hưởng khi cùng hướng).
3. Mock BOS LONG hợp lệ + `htfContext = { bias: null, ... }` (không xác định được) → assert vẫn có signal (không bị chặn).
4. Tương tự tối thiểu 1 case cho Sweep và 1 case cho FVG (mock hướng ngược HTF bias → không có signal).
5. Case kết hợp: sweep bị chặn bởi HTF bias tại 1 index, nhưng FVG hợp lệ cùng index và cùng hướng HTF bias → assert FVG **vẫn xuất hiện** (xác nhận không lặp lại bug `return` của task trước — đây là test bắt buộc quan trọng nhất của subtask này).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm test hiện có.
- Setup ngược HTF bias (khi bias xác định) không bao giờ xuất hiện trong candidates — verify bằng test cho cả 3 setup.
- Setup cùng hướng hoặc HTF bias null hoạt động y hệt trước khi có gate.
- Test case "kết hợp" ở mục 5 pass, chứng minh không có setup nào bị chặn nhầm do gate của setup khác.

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau cho cả 3 khối.
- Test case đã thêm, giải thích từng case, đặc biệt case số 5.
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
