# Task 02 — Trả lời câu hỏi còn treo: checkShiftedFallback có làm hẹp lại IRB không? (MEDIUM)

## Vấn đề

Câu hỏi này được đặt ra từ `tasks/fix-review-round4-findings/02-*` nhưng
chưa có `result.md` nào trả lời — vẫn còn treo qua vòng review round 5.

`src/charts/setups/irb.ts`, hàm `checkShiftedFallback` (~dòng 12): tính lại
1 cửa sổ compression MỚI (`fallbackInner`, `endIndex = index - 2`) thay vì
dùng lại trực tiếp `rangeInner.high`/`.low` đã tính sẵn (cách code TRƯỚC
round 3 làm). Review round 5 phát hiện thêm: cách này cũng đòi hỏi
`index >= 2` (trước đó chỉ cần `index >= 1`), thu hẹp phạm vi áp dụng thêm 1
chút (dù có thể không quan trọng vì `ema20`/`atr14` cần warm-up ~20 nến).

## Yêu cầu

1. Viết 2 test case cụ thể trong `tests/charts/irb-fallback.test.ts`:
   - Case A: dữ liệu nến mà `rangeInner` (đã tính ở `index-1`) hợp lệ, VÀ
     nếu dùng trực tiếp `rangeInner.high`/`.low` để so sánh (cách cũ) thì
     fallback sẽ ACCEPT — nhưng `detectCompression` tính lại ở `index-2`
     (cách hiện tại) KHÔNG tìm thấy compression hợp lệ (trả `null`) → xác
     nhận xem `detectIrb` có REJECT nhầm case này không (nếu có, đây là
     regression thật, cần fix).
   - Case B: ngược lại, dữu liệu mà cách cũ REJECT nhưng cách mới ACCEPT
     (nếu có).

2. Nếu Case A xảy ra (cách mới hẹp hơn cách cũ mà không có lý do chính
   đáng) — sửa `checkShiftedFallback` để dùng `rangeInner` trực tiếp thay vì
   tính lại `fallbackInner`, GIỐNG cách code trước round 3, chỉ giữ lại phần
   dedup LONG/SHORT (không đổi logic tính toán).

3. Nếu KHÔNG tái tạo được sự khác biệt nào qua test (2 cách cho kết quả
   giống hệt nhau với mọi input hợp lý) — ghi rõ trong `result.md`, KHÔNG
   cần sửa gì, chỉ thêm comment giải thích tại sao 2 cách tương đương.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts tests/charts/irb-fallback.test.ts
```

## Ghi kết quả

`result.md`: 2 test case đã viết, kết luận (có regression hay không), thay
đổi đã làm (nếu có), kết quả build + test.
