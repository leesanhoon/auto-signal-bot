# Task 03: Gate Entries by Premium/Discount Zone

**Đọc trước:** [`../plan.md`](../plan.md) — bắt buộc. **Chạy sau khi subtask 02 đã approved.**

## Mục tiêu

Chuẩn SMC/ICT: LONG chỉ nên vào từ vùng **discount** (dưới 50% dealing range), SHORT chỉ nên vào từ vùng **premium** (trên 50%). Hiện tại `calculatePremiumDiscountZone` được gọi và kết quả lưu vào `signal.premiumDiscountZone` nhưng KHÔNG ảnh hưởng gì đến việc chấp nhận/loại bỏ hay điểm số của setup — chỉ nằm đó làm dữ liệu hiển thị.

## Vị trí cần sửa

`src/charts/smc/smc-pipeline.ts`, trong `buildSmcCandidatesAtIndex`, đoạn xử lý BOS/CHOCH+OB (khoảng dòng 134-198) — đây là setup duy nhất hiện có tính `pdZone` (dòng ~139):

```ts
const pdZone = calculatePremiumDiscountZone(entry, swings, index);
```

## Việc cần làm

1. Sau khi có `pdZone`, xác định "đúng zone" theo rule:
   - `structure.direction === "LONG"` → đúng zone khi `pdZone.zone === "DISCOUNT"`.
   - `structure.direction === "SHORT"` → đúng zone khi `pdZone.zone === "PREMIUM"`.
   - Nếu `pdZone === null` (không tính được dealing range) → coi là "không xác định", KHÔNG loại setup (giữ hành vi cũ khi thiếu dữ liệu), nhưng không được cộng điểm.
   - `EQUILIBRIUM` (45-55%) → coi là trung tính, không đúng cũng không sai zone.
2. Áp dụng rule vào confidence/score/grade của setup OB (đang là 80/"A" cho BOS, 72/"B" cho CHOCH):
   - Nếu **sai zone rõ ràng** (LONG tại PREMIUM, hoặc SHORT tại DISCOUNT): trừ 15 điểm khỏi confidence và score gốc (ví dụ BOS: 80 → 65; CHOCH: 72 → 57), grade tính lại bằng `gradeFromScore` (import từ `smc-signal-assembly.js`, đã có sẵn trong file — xem dòng import đầu file).
   - Nếu **đúng zone**: giữ nguyên confidence/score gốc như hiện tại (KHÔNG cộng thêm điểm ở subtask này — chỉ phạt sai zone, không thưởng đúng zone, để tránh double-count với confluence bonus đã có).
   - Nếu **EQUILIBRIUM hoặc không xác định**: giữ nguyên confidence/score gốc.
3. Thêm dòng vào `ruleTrace` mô tả rõ zone và việc có bị phạt hay không, ví dụ:
   - Đúng/trung tính: `"Premium/Discount: {zone} ({percent}% range)."`
   - Sai zone: `"Cảnh báo: vào lệnh {LONG/SHORT} tại vùng {zone} — ngược nguyên tắc premium/discount, đã hạ điểm."`
4. **Chỉ áp dụng cho setup BOS/CHOCH+OB** trong subtask này (đây là setup duy nhất hiện tính `pdZone`). Không mở rộng sang Liquidity Sweep/FVG Continuation — nếu muốn áp dụng cho các setup đó cần tính `pdZone` riêng, ngoài phạm vi subtask này.

## Việc KHÔNG được làm

- Không loại bỏ hoàn toàn setup sai zone (không return null/không push vào candidates) — chỉ hạ điểm. Lý do: vẫn có thể có setup A grade hợp lệ dù sai zone nhẹ, để confluence bonus/malus ở tầng `analyzeAllChartsSmc` tự quyết định cuối cùng.
- Không đổi ngưỡng `gradeFromScore` trong `smc-signal-assembly.ts`.
- Không đổi setup Liquidity Sweep / FVG Continuation.
- Không đổi cách tính `calculatePremiumDiscountZone` trong `smc-liquidity-context.ts`.

## Test cần thêm/sửa

Trong `tests/charts/smc/smc-pipeline.test.ts`:
1. Dựng dữ liệu nến sao cho setup BOS LONG xuất hiện với entry (OB midpoint) rơi vào vùng PREMIUM (≥55% dealing range) → assert confidence bị hạ xuống 65 (không phải 80), grade tính lại đúng theo `gradeFromScore(65)`.
2. Dựng dữ liệu nến sao cho setup BOS LONG xuất hiện với entry rơi vào vùng DISCOUNT (≤45%) → assert confidence giữ nguyên 80, grade "A".
3. Case entry rơi vào EQUILIBRIUM → assert confidence giữ nguyên gốc, không bị phạt.
4. Rà soát test case cũ đang assert confidence cố định 80/72 cho setup OB — nếu case đó vô tình rơi vào vùng sai zone theo dữ liệu test hiện có, cập nhật lại dữ liệu test hoặc assertion cho khớp rule mới (ghi rõ trong `result.md` case nào bị ảnh hưởng và vì sao).

## Acceptance Criteria

- `npm run build` pass.
- `npm test` pass, không giảm số test.
- Setup LONG tại PREMIUM hoặc SHORT tại DISCOUNT luôn có confidence thấp hơn setup cùng loại đúng zone (verify bằng test).

## Kết quả cần ghi vào `result.md`

- Đoạn code trước–sau.
- Danh sách test case đã thêm/sửa, giải thích từng case.
- Danh sách test case cũ bị ảnh hưởng bởi thay đổi confidence (nếu có) và cách đã xử lý.
- Output build/test.
- Nếu bị chặn → ghi `blocked.md`.
