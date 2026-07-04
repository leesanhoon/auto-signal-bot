# Global Claude Code Rules

## Quy tắc Plan Mode

Khi đang ở **Plan Mode** (ExitPlanMode / chế độ lập kế hoạch trước khi code):

1. **Luôn** ghi plan ra file, KHÔNG chỉ trả lời trong chat.
2. Đường dẫn file: `plans/YYYY-MM-DD-<mô-tả-ngắn>.md` (relative theo root của project hiện tại).
   - `YYYY-MM-DD`: ngày hiện tại.
   - `<mô-tả-ngắn>`: kebab-case, 3-6 từ tóm tắt task (vd: `plans/2026-07-04-refactor-auth-flow.md`).
   - Nếu thư mục `plans/` chưa tồn tại, tự tạo.
3. Nội dung file plan bắt buộc gồm các phần:
   - `# Mục tiêu` — mô tả ngắn gọn task cần làm.
   - `# Bối cảnh / Phân tích` — hiện trạng code, các ràng buộc liên quan.
   - `# Các bước thực hiện` — checklist đánh số, mỗi bước là 1 việc cụ thể, có thể verify được.
   - `# Rủi ro / Lưu ý` — các điểm cần cẩn thận, edge case, breaking change (nếu có).
   - `# Tiêu chí hoàn thành` — điều kiện để coi task là done (test pass, build ok, v.v.)
4. Sau khi ghi file plan, tóm tắt ngắn gọn trong chat (không lặp lại toàn bộ nội dung file) và trỏ đường dẫn file cho user xác nhận trước khi triển khai.
5. Không tự động thoát Plan Mode / bắt đầu code khi chưa có xác nhận của user, trừ khi user đã yêu cầu rõ "làm luôn".

## Quy tắc Code Review

Khi được yêu cầu **review code** (review PR, review file, review diff, v.v.) và phát hiện có vấn đề (bug, code smell, vi phạm convention, rủi ro bảo mật, performance issue...):

1. **Luôn** ghi kết quả review ra file, KHÔNG chỉ trả lời trong chat.
2. Đường dẫn file: `reviews/YYYY-MM-DD-<mô-tả-ngắn>.md` (relative theo root của project hiện tại).
   - `<mô-tả-ngắn>`: kebab-case, mô tả phạm vi được review (vd: `reviews/2026-07-04-payment-service-review.md`).
   - Nếu thư mục `reviews/` chưa tồn tại, tự tạo.
3. Nội dung file review bắt buộc gồm:
   - `# Phạm vi review` — file/module/PR nào được review.
   - `# Tóm tắt` — mức độ nghiêm trọng tổng quan (Critical / Major / Minor / Nitpick).
   - `# Danh sách vấn đề` — mỗi vấn đề gồm:
     - Vị trí (file:line nếu có).
     - Mô tả vấn đề.
     - Mức độ nghiêm trọng.
     - Đề xuất fix.
   - `# Điểm tốt` (nếu có) — những gì code đã làm đúng, đáng giữ lại.
4. Nếu review KHÔNG phát hiện vấn đề gì, không bắt buộc phải tạo file — có thể trả lời ngắn gọn trong chat.
5. Sau khi ghi file review, tóm tắt số lượng vấn đề theo mức độ nghiêm trọng trong chat và trỏ đường dẫn file.

## Quy tắc chung khi làm việc

- Trước khi thực hiện task phức tạp, chia nhỏ task và xác nhận hiểu đúng yêu cầu trước khi bắt đầu.
- Nếu thiếu thông tin quan trọng để lập plan hoặc review chính xác, hỏi lại thay vì đoán.
- Ưu tiên tính nhất quán: dùng cùng một format ngày tháng (YYYY-MM-DD) và naming convention (kebab-case) cho mọi file plan/review.
