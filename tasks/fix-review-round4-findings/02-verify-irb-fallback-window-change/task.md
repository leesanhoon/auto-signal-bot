# Task 02 — Xác nhận thay đổi logic trong checkShiftedFallback là chủ đích (MEDIUM)

## Vấn đề

`src/charts/setups/irb.ts`, hàm `checkShiftedFallback` (~dòng 12): tính lại
1 cửa sổ compression MỚI (`fallbackInner`, `endIndex = index - 2`) thay vì
dùng lại trực tiếp `rangeInner.high`/`.low` đã tính sẵn từ trước (như code
gốc trước round 3 làm). Đây có thể là 1 fix đúng đắn (tránh lại đúng loại bug
"cửa sổ bao gồm chính nến breakout" mà round 1 đã fix) — nhưng task tạo ra
thay đổi này (`fix-review-round3-findings/05-dedupe-irb-fallback-scaffolding`)
được mô tả là "KHÔNG đổi logic/threshold" (thuần túy refactor/dedup). Cần xác
nhận đây là chủ đích, không phải side-effect ngoài ý muốn.

## Yêu cầu

1. Đọc lại `git log`/`git diff` của thay đổi này (hoặc so sánh trực tiếp
   `checkShiftedFallback` hiện tại với logic gốc trước khi có helper — có thể
   xem `tasks/fix-ohlc-review-findings/05-fix-irb-dead-fallback/task.md` để
   biết thiết kế fallback GỐC trước khi có helper `checkShiftedFallback`).

2. Xác định: việc dùng `fallbackInner` (tính lại ở `index-2`) thay vì
   `rangeInner` (đã tính sẵn) có làm THAY ĐỔI kết quả `detectIrb` trả về cho
   BẤT KỲ input nào so với thiết kế TRƯỚC round 3 hay không? Viết 1-2 test
   case cụ thể (nến giả) để so sánh — nếu cho cùng input mà 2 cách tính ra
   kết quả khác nhau, đó là bằng chứng cụ thể.

3. Nếu xác nhận đây là 1 fix đúng đắn (giải quyết bug tương tự round 1) —
   ghi rõ trong `result.md`, KHÔNG cần sửa gì thêm, coi như đã fix đúng, chỉ
   cần document lại rõ ràng trong comment/JSDoc của `checkShiftedFallback`
   giải thích TẠI SAO cần tính lại thay vì dùng `rangeInner` trực tiếp (để
   người sau không "dọn dẹp" nhầm quay lại cách cũ).

4. Nếu phát hiện đây là THAY ĐỔI KHÔNG MONG MUỐN (làm sai lệch kết quả so
   với thiết kế gốc mà không có lý do chính đáng) — sửa lại cho khớp thiết kế
   gốc HOẶC nếu bạn thấy cách hiện tại (tính lại) thực sự đúng hơn, vẫn giữ
   nguyên nhưng phải document rõ.

## Verification

```bash
npm run build
npm run test -- --run tests/charts/setups.test.ts tests/charts/irb-fallback.test.ts
```

## Ghi kết quả

`result.md`: kết luận (chủ đích hay không), bằng chứng (test case so sánh
nếu có khác biệt), thay đổi đã làm (nếu có, hoặc chỉ thêm doc).
