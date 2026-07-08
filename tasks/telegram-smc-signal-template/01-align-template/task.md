# Task: Align Telegram SMC Signal Template

## Objective
Cập nhật output signal SMC gửi vào Telegram để nội dung thực tế khớp mẫu mong muốn của user, bao gồm cả format hiển thị lẫn dữ liệu từng target. Sau khi làm xong, worker phải ghi kết quả vào `tasks/telegram-smc-signal-template/01-align-template/result.md`.

## Background
Lead đã review nhanh và thấy:
- Luồng gửi message SMC hiện đi qua `src/shared/telegram.ts -> buildSmcSignalMessage`
- Dữ liệu SMC được map vào `TradeSetup` ở `src/charts/smc/smc-signal-assembly.ts`
- Repo đã có test gần đúng với mẫu user trong `tests/shared/telegram.test.ts`
- Có một gap cần xác minh/sửa: formatter đang dùng chung `setup.riskReward` cho mọi TP, trong khi mẫu user cho thấy `TP1/TP2/TP3` có thể có `R:R` khác nhau

## Instructions
1. Review các file sau trước khi sửa:
   - `src/shared/telegram.ts`
   - `src/charts/chart-types.ts`
   - `src/charts/smc/smc-types.ts`
   - `src/charts/smc/smc-signal-assembly.ts`
   - `tests/shared/telegram.test.ts`
2. Căn chỉnh `buildSmcSignalMessage` để output production khớp mẫu user về:
   - Header signal
   - Separator / spacing / block order
   - Entry / Entry Zone / SL / TP lines
   - NHẬN ĐỊNH / QUẢN LÝ VỐN / THẬN TRỌNG
3. Xác minh và sửa luồng dữ liệu nếu template cần thông tin mà `TradeSetup` hiện chưa mang đủ.
4. Đặc biệt kiểm tra bài toán `R:R` per target:
   - Nếu hiện tại chưa support `TP2`, `TP3` có `R:R` riêng, hãy bổ sung thiết kế nhỏ gọn và typed rõ ràng
   - Không hardcode riêng cho sample; phải render từ data
5. Cập nhật hoặc bổ sung test trong `tests/shared/telegram.test.ts` để contract phản ánh đúng template mong muốn.
6. Chạy test liên quan để verify.
7. Ghi `result.md` gồm:
   - Files đã sửa
   - Những quyết định chính
   - Lệnh test đã chạy và kết quả
   - Gap còn lại nếu có

## Acceptance Criteria
- [ ] Signal SMC Telegram khớp template user về cấu trúc nội dung
- [ ] Nếu user template cần `R:R` riêng theo TP, output thực tế support đúng dữ liệu này
- [ ] Luồng `sendAllAnalyses(... setup.detectionSource === "smc" ...)` vẫn hoạt động bình thường
- [ ] Test trong `tests/shared/telegram.test.ts` chứng minh format mới
- [ ] Worker tạo `result.md` trong đúng thư mục task

## Files to Touch
- `src/shared/telegram.ts`
- `src/charts/chart-types.ts`
- `src/charts/smc/smc-types.ts`
- `src/charts/smc/smc-signal-assembly.ts`
- `tests/shared/telegram.test.ts`
- `tasks/telegram-smc-signal-template/01-align-template/result.md`

## Suggested Verification
- `npm test -- tests/shared/telegram.test.ts`

## If Blocked
Nếu gặp blocker hoặc ambiguity không thể tự resolve an toàn, tạo `tasks/telegram-smc-signal-template/01-align-template/blocked.md` thay vì đoán.
