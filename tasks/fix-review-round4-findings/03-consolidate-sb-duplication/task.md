# Task 03 — Giảm rủi ro lệch nhau giữa 2 bản logic SB (backtest vs live) (LOW)

## Vấn đề

Sau khi task 01 (round này) sửa xong, logic "phát hiện false-break → chờ →
xác nhận SB" tồn tại ở 2 nơi tách biệt:
- `src/charts/setup-sb-runner.ts` (`runSbDetection`) — dùng bởi live pipeline
  (`deterministic-pipeline.ts`), xử lý đồng bộ trong 1 lần gọi.
- `src/charts/setup-backtest.ts` — dùng pending-queue xuyên suốt vòng lặp
  walk-forward (đã sửa ở task 01).

2 bản có hằng số trùng nhau đang lệch cách khai báo: `setup-sb-runner.ts`
dùng `SB_BUILDUP_LOOKAHEAD = 3` (hằng số đặt tên rõ ràng), còn
`setup-backtest.ts` hardcode số `3` trực tiếp trong code. Rủi ro: sau này tinh
chỉnh giá trị này (ví dụ đổi từ 3 lên 4 nến) chỉ sửa 1 chỗ, quên chỗ kia.

## Yêu cầu

1. Export `SB_BUILDUP_LOOKAHEAD` từ `src/charts/setup-sb-runner.ts` (thêm
   `export` vào khai báo `const SB_BUILDUP_LOOKAHEAD = 3;`).

2. Trong `src/charts/setup-backtest.ts`, import và dùng lại hằng số này thay
   vì hardcode số `3` — thay mọi chỗ đang viết `pending.triggerIndex + 3`
   bằng `pending.triggerIndex + SB_BUILDUP_LOOKAHEAD`.

3. Tương tự, kiểm tra số `2` (ngưỡng tối thiểu để check false-break,
   `maxLookahead` trong `isFalseBreak`) — nếu `setup-sb-runner.ts` cũng có
   hằng số tương ứng, dùng lại; nếu không có, có thể để nguyên (số `2` này
   gắn liền với `isFalseBreak`'s tham số mặc định, không nhất thiết cần đặt
   tên riêng — tùy bạn đánh giá).

## KHÔNG làm

- Không gộp 2 file thành 1 (đây là task LOW priority, chỉ giảm rủi ro hằng
  số lệch nhau, không redesign kiến trúc — việc gộp sâu hơn để lại cho quyết
  định sau nếu cần).
- Không đổi giá trị `SB_BUILDUP_LOOKAHEAD` (vẫn là 3).

## Verification

```bash
npm run build
npm run test -- --run
```

## Ghi kết quả

`result.md`: thay đổi cụ thể, kết quả build + test.
