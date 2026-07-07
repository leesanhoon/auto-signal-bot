# Task 03 — Thực sự trả lời câu hỏi IRB fallback window (LOW, câu hỏi treo từ round 4)

## Vấn đề

`tasks/fix-review-round5-findings/02-*` yêu cầu viết 2 test case so sánh
hành vi `checkShiftedFallback` (tính lại window ở `index-2`) với hành vi CŨ
(dùng trực tiếp `rangeInner` đã có sẵn):

- Case A (ĐÁNG LO — chưa được test): code CŨ chấp nhận (accept) 1 pattern,
  code MỚI (recompute) từ chối (reject) nhầm.
- Case B (không đáng lo — đã test): code CŨ từ chối, code MỚI chấp nhận.

`tasks/fix-review-round5-findings/02-*` result.md CHỈ viết Case B (và 1 test
khác không phải Case A thật sự — chỉ chứng minh cả 2 cách đều reject giống
nhau, không phải case cũ accept mới reject). Case A — case thực sự đáng lo —
CHƯA được kiểm chứng.

## Yêu cầu

1. Đọc `src/charts/setups/irb.ts`, hàm `checkShiftedFallback` (recompute
   `fallbackInner` ở `index-2`) và hiểu rõ nó khác gì so với việc dùng trực
   tiếp `rangeInner.high`/`.low` (đã tính sẵn ở `index-1`).

2. Cố gắng dựng 1 bộ dữ liệu nến CỤ THỂ mà:
   - `rangeInner` (tính ở `index-1`) tồn tại và hợp lệ.
   - Nếu so sánh TRỰC TIẾP `candles[index-1].high > rangeInner.high` (cách
     cũ) → TRUE (accept).
   - NHƯNG `detectCompression(candles, ..., index-2, matchedInnerWindow,
     kBlockInner)` (cách mới, tính `fallbackInner`) → trả `null` HOẶC ra 1
     compression window mà so sánh `candles[index-1].high > fallbackInner.high`
     → FALSE (reject nhầm).

3. Nếu dựng được case này → xác nhận đây LÀ 1 regression thật, BÁO CÁO rõ
   ràng (không tự ý sửa code trừ khi bạn chắc chắn cách sửa đúng — có thể để
   `blocked.md` nếu cần Lead quyết định hướng sửa, vì đây liên quan tới logic
   detect signal, cần cẩn thận).

4. Nếu THỬ NHIỀU cách (ít nhất 3-4 bộ dữ liệu nến khác nhau) mà KHÔNG dựng
   được Case A (tức 2 cách LUÔN cho kết quả giống nhau, hoặc cách mới luôn
   ACCEPT nhiều hơn hoặc bằng cách cũ, không bao giờ ít hơn) — kết luận rõ
   ràng trong `result.md`: "Đã thử N bộ dữ liệu khác nhau (liệt kê), không
   tái tạo được Case A — kết luận: cách mới không làm hẹp lại phạm vi chấp
   nhận so với cách cũ." Đây MỚI là kết luận có căn cứ, khác với round 5 chỉ
   test 1 hướng.

## KHÔNG làm

- Không tự ý sửa `checkShiftedFallback` trừ khi CHẮC CHẮN đã tìm thấy Case A
  thật và biết cách sửa an toàn.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts tests/charts/setups/irb-fallback.test.ts
```

## Ghi kết quả

`result.md`: liệt kê các bộ dữ liệu đã thử, kết luận cuối cùng (có Case A
hay không, kèm bằng chứng test cụ thể), thay đổi đã làm (nếu có) hoặc
`blocked.md` nếu cần Lead quyết định.
