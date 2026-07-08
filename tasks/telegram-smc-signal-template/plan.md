# Task Plan: Align Telegram SMC Signal Template

## Overview
Mục tiêu là làm cho nội dung signal SMC gửi vào Telegram khớp với mẫu mong muốn của user: header rõ ràng, khối entry/SL/TP dễ đọc, phần nhận định và quản lý vốn đầy đủ, và dữ liệu từng TP phản ánh đúng thông tin thực tế của signal.

Repo hiện đã có formatter riêng cho SMC trong `src/shared/telegram.ts` (`buildSmcSignalMessage`) và pipeline đã bơm khá nhiều metadata SMC qua `buildTradeSetupFromSmcSignal`. Tuy nhiên cần review và chỉnh cho template production khớp hoàn toàn với mẫu user đưa ra, thay vì chỉ "gần giống".

## Architecture Decisions
- Giữ một formatter SMC duy nhất tại `src/shared/telegram.ts` để toàn bộ luồng gửi Telegram dùng chung một chuẩn hiển thị.
- Tiếp tục route theo `setup.detectionSource === "smc"` trong `sendAllAnalyses`; không fork thêm luồng gửi riêng.
- Nếu template yêu cầu thông tin mà `TradeSetup` hiện chưa mang đủ, bổ sung field typed ở `src/charts/chart-types.ts` và map từ `src/charts/smc/smc-signal-assembly.ts`.
- Ưu tiên sửa dữ liệu nguồn hơn là hardcode trong formatter. Ví dụ: nếu mỗi TP cần `R:R` khác nhau thì không nên tái dùng một `riskReward` string chung cho mọi target.
- Dùng test ở `tests/shared/telegram.test.ts` làm contract chính cho format message, và bổ sung test nếu phát hiện khoảng trống.

## Known Gap To Check
- `buildSmcSignalMessage` hiện đang dùng cùng một `setup.riskReward` cho mọi dòng TP.
- Mẫu user yêu cầu `TP1`, `TP2`, `TP3` có thể có `R:R` khác nhau.
- Worker cần xác nhận đây có phải gap thực sự trong output production không, rồi chọn hướng sửa tối thiểu nhưng đúng kiến trúc.

## File Changes
- `src/shared/telegram.ts` - Căn chỉnh format Telegram cho signal SMC theo mẫu final
- `src/charts/chart-types.ts` - Bổ sung type nếu cần thêm metadata cho từng TP
- `src/charts/smc/smc-types.ts` - Bổ sung type nguồn nếu cần
- `src/charts/smc/smc-signal-assembly.ts` - Map đủ metadata từ SMC signal sang `TradeSetup`
- `tests/shared/telegram.test.ts` - Cập nhật/bổ sung contract test cho template
- Tùy kết quả review: test liên quan khác nếu worker thấy có chỗ phụ thuộc formatter mới

## Testing Strategy
- Chạy test targeted cho `tests/shared/telegram.test.ts`
- Nếu có đổi type/assembly ảnh hưởng luồng SMC, chạy thêm test SMC liên quan
- Nếu có thể, verify message string thực tế bằng một fixture gần mẫu user

## Subtasks
| Subtask ID | Description | Owner | Files to Modify | Dependencies | Expected Output |
|------------|-------------|-------|-----------------|--------------|-----------------|
| 01-align-template | Căn chỉnh template Telegram SMC để khớp mẫu user và cập nhật test contract | worker | `src/shared/telegram.ts`, `src/charts/chart-types.ts`, `src/charts/smc/smc-types.ts`, `src/charts/smc/smc-signal-assembly.ts`, `tests/shared/telegram.test.ts` | None | Formatter + mapping + tests phản ánh đúng template signal mong muốn |
