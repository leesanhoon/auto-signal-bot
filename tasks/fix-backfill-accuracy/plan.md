# Plan — Sửa lỗi sai lệch trong result.md vừa backfill + audit lại 17 file còn lại

## Context

Task `backfill-missing-results` vừa xong đã tạo `result.md` cho 18 subtask
thiếu tài liệu (round 2/3/4). Nhưng phát hiện 1 lỗi sai cụ thể: KHÔNG có git
commit nào giữa các round (toàn bộ nằm chung 1 working tree diff so với
HEAD gốc) — nghĩa là worker viết backfill KHÔNG CÓ CÁCH NÀO xác minh chính
xác "thay đổi X xảy ra ở round nào" bằng git history, nhưng vẫn viết khẳng
định thời điểm như thể chắc chắn (VD:
`tasks/fix-review-round2-findings/02-fix-irb-fallback-test-mock/result.md`
ghi "replaced... in round 6" — SAI, thực tế đã xảy ra ở round 2, xác nhận
qua nội dung review trực tiếp trong phiên làm việc trước đó, không phải qua
git).

## 2 subtask

- `01-fix-known-inaccuracy/` — sửa NGAY lỗi đã biết cụ thể (round2/02)
- `02-audit-remaining-17-files/` — rà soát lại 17 file backfill còn lại,
  loại bỏ mọi khẳng định thời điểm ("ở round N") KHÔNG THỂ xác minh được
  bằng git, thay bằng cách diễn đạt trung thực hơn

## Verification

Không sửa code, chỉ sửa nội dung `result.md` — không cần build/test.
