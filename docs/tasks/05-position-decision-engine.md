# Phase 05: Position decision engine

## Mục tiêu
`position-decision.ts` hiện còn đơn giản: cần bổ sung take-profit theo từng phần, trailing stop/dynamic SL, và enforce risk-reward ratio tối thiểu trước khi mở lệnh. Đây là phần lõi nghiệp vụ ảnh hưởng trực tiếp tới kết quả giao dịch.

## Bối cảnh / file liên quan
- [src/charts/position-decision.ts](../../src/charts/position-decision.ts): export `decidePosition` (entry point chính, chọn model), `decidePositionWithClaude`, hàm nội bộ `decidePositionWithGemini`; có helper extract/clean JSON từ response LLM.
- [src/charts/positions-repository.ts](../../src/charts/positions-repository.ts): truy cập bảng `open_positions` trong Supabase.
- [src/charts/check-open-trades-runner.ts](../../src/charts/check-open-trades-runner.ts): runner định kỳ kiểm tra vị thế đang mở, có thể là nơi cần gọi logic trailing stop.

## Việc cần làm
- [x] Thiết kế schema cho partial TP: TP1/TP2 với % đóng lệnh tương ứng (vd đóng 50% tại TP1, phần còn lại chạy tới TP2).
- [x] Thêm field cần thiết vào bảng `open_positions` (migration mới) để lưu trạng thái partial TP đã đóng bao nhiêu %.
- [x] Implement logic trailing stop / dynamic SL: sau khi giá đạt TP1, dời SL về breakeven hoặc theo trailing distance cấu hình.
- [x] Implement enforce risk-reward ratio tối thiểu (vd R:R >= 1:1.5) — nếu model đề xuất lệnh không đạt ngưỡng, từ chối mở lệnh hoặc yêu cầu phân tích lại.
- [x] Cập nhật `check-open-trades-runner.ts` để gọi logic trailing stop khi kiểm tra định kỳ.
- [x] Cập nhật thông báo Telegram khi có partial close / trailing SL update, để người dùng theo dõi được.

## Acceptance criteria
- [x] Unit test (xem [Phase 01](01-testing.md)) cho các nhánh: đạt TP1 → đóng % và dời SL; đạt TP2 → đóng toàn bộ; R:R dưới ngưỡng → từ chối mở lệnh.
- [x] Lệnh thực tế (giả lập) có ghi nhận đúng trạng thái partial TP trong `open_positions`.
- [x] Telegram nhận được thông báo rõ ràng khi có sự kiện partial TP/trailing SL.

## Ghi chú / rủi ro
- Cần đồng bộ với Phase 06 (performance tracking) vì thay đổi cấu trúc lệnh ảnh hưởng tới cách tính win-rate/R:R thực tế.
