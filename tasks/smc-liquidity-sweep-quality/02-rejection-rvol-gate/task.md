# Task 02: Rejection Wick + RVOL Confirmation Gate

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 01 đã approved** (cùng sửa `smc-pipeline.ts`, tránh conflict).

## Mục tiêu

Setup `SMC_BOS_OB`/`SMC_CHOCH_OB` đã dùng `detectRejectionWick` + `calculateRvol` (trong `smc-liquidity-context.ts`, đã có sẵn, không cần viết mới) để xác nhận chất lượng tín hiệu. Setup `SMC_LIQUIDITY_SWEEP` — vốn về bản chất **cần** xác nhận rejection/volume nhất (một "stop hunt" thật của smart money thường có đuôi nến dài + volume tăng đột biến trước khi đảo chiều) — hiện hoàn toàn không dùng 2 hàm này.

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`, đoạn xử lý sweep (sau khi subtask 01 đã thêm depth gate). Tham khảo cách setup OB đã dùng 2 hàm này (cùng file, khoảng dòng 196-197):

```ts
const rvol = calculateRvol(scopedCandles, index);
const rejection = detectRejectionWick(scopedCandles[index], structure.direction);
```

## Việc cần làm

1. Trong khối xử lý sweep (sau khi đã qua depth gate của subtask 01), gọi:
   - `const rejection = detectRejectionWick(scopedCandles[index], direction);` (dùng `direction` = `sweep.direction`, biến đã có sẵn trong khối).
   - `const rvol = calculateRvol(scopedCandles, index);`
2. Định nghĩa "xác nhận chất lượng" khi **cả 2 điều kiện** sau đúng:
   - `rejection.hasRejectionWick === true` (wick ratio ≥ 0.5, đã định nghĩa sẵn trong `detectRejectionWick`).
   - `rvol !== null && rvol >= 1.2` (volume cao hơn 20% so trung bình 20 nến gần nhất — hệ số 1.2 dùng đúng như quy định, không tự đổi).
3. Áp dụng vào confidence (thực hiện **trước** khi gọi `applySessionPenalty`, để giữ đúng thứ tự: base confidence → điều chỉnh chất lượng → session penalty, nhất quán với cách setup OB áp dụng premium/discount trước session ở task trước):
   - Nếu **có xác nhận** (cả rejection wick và RVOL đạt): `baseConfidence = 72` (tăng nhẹ từ 68 mặc định, phản ánh chất lượng cao hơn).
   - Nếu **không có xác nhận**: `baseConfidence = 55` (hạ từ 68, phản ánh thiếu bằng chứng smart money thật).
   - Đây thay cho hằng số `68` đang truyền cứng vào `applySessionPenalty(...)` hiện tại — sửa lời gọi để dùng `baseConfidence` biến thiên thay vì số 68 cố định.
4. Thêm dòng vào `ruleTrace` (truyền vào `applySessionPenalty` như phần tử cuối mảng, giữ nguyên câu đầu `"Liquidity sweep và reclaim xác nhận hướng giao dịch."`):
   - Có xác nhận: `"Xác nhận rejection wick + RVOL {rvol.toFixed(2)} cho thấy áp lực smart money thật."`
   - Không có xác nhận: `"Cảnh báo: thiếu rejection wick mạnh hoặc RVOL thấp — độ tin cậy sweep giảm."`
5. Gắn `hasRejectionWick: rejection.hasRejectionWick` và `rvol: rvol ?? undefined` vào `opts` của `buildSignal` cho setup Sweep (hiện các field này tồn tại trong `SmcSignal` type nhưng chưa được gán cho setup Sweep — xem `smc-types.ts`, field `rvol`, `hasRejectionWick`).

## Việc KHÔNG được làm

- Không đổi `detectRejectionWick`/`calculateRvol` trong `smc-liquidity-context.ts`.
- Không loại bỏ hoàn toàn setup khi không có xác nhận (chỉ hạ confidence xuống 55, không return null) — nhất quán với nguyên tắc "chỉ hạ điểm, không loại cứng" đã áp dụng ở các gate trước.
- Không đổi 2 setup còn lại.
- Không đổi ngưỡng depth gate của subtask 01.
- Không tự đổi hệ số `1.2` (RVOL) hay `72`/`55` (confidence) — nếu thấy cần điều chỉnh khi test thực tế, ghi vào `result.md` để Lead xem xét.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Mock sweep hợp lệ (qua depth gate) + `detectRejectionWick` trả `hasRejectionWick: true` + RVOL ≥ 1.2 → assert confidence = 72 (trừ session penalty nếu áp dụng), `ruleTrace` chứa câu xác nhận, `rvol`/`hasRejectionWick` được gán đúng vào signal.
2. Mock sweep hợp lệ nhưng `hasRejectionWick: false` (hoặc RVOL < 1.2) → assert confidence = 55, `ruleTrace` chứa câu cảnh báo.
3. Rà soát 3 test case cũ của subtask trước liên quan Sweep (`Liquidity sweep in OFF_HOURS...`, `...in ASIA...`, `...in LONDON_NY_OVERLAP...`) — các test này hiện đang giả định base confidence = 68 cố định; cần cập nhật mock để có `hasRejectionWick`/`rvol` phù hợp (ví dụ mock đạt xác nhận để giữ base = 72, hoặc cập nhật số mong đợi theo 55/72 tương ứng). Ghi rõ trong `result.md` case nào bị ảnh hưởng và cách xử lý.

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm số test.
- Sweep có rejection wick mạnh + RVOL cao luôn có confidence cao hơn sweep không có xác nhận (verify bằng test).

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau.
- Test case đã thêm/sửa, giải thích từng case.
- Danh sách test case cũ bị ảnh hưởng bởi thay đổi base confidence và cách đã xử lý.
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
