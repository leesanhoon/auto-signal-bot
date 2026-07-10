# Lead Review (Phase 3) — signal-freshness-guard

**Verdict: CHANGES_REQUIRED — chưa được ghi done.md**

Build pass và 741/741 tests pass, nhưng Lead đã chạy reproduction với call
pattern production thật và chứng minh **tính năng chính không hoạt động**
(guard no-op với mọi pair forex). Chi tiết đầy đủ:

- `reviews/signal-freshness-guard/review-summary.md`
- `reviews/signal-freshness-guard/review-03-integrate-smc-volman.md` — ISSUE-1 (critical), ISSUE-2, ISSUE-5
- `reviews/signal-freshness-guard/review-04-candle-age-in-message.md` — ISSUE-3, ISSUE-4

## Kết quả từng subtask

- **01 fetch-last-price: APPROVED.** Đúng pattern codebase, tái sử dụng
  fetchJson/rate-limit/retry, tests thật, không deviation.
- **02 freshness-guard-core: APPROVED (minor M2).** Logic LONG/SHORT đúng,
  fail-open khi fetch lỗi đúng thiết kế, env flag đúng.
- **03 integrate-smc-volman: CHANGES_REQUIRED.** Truyền `setup.pair` thay vì
  symbol → guard không bao giờ lọc được gì (đã chứng minh runtime); guard đặt
  sau auto-track; integration test mock chính thứ nó cần test.
- **04 candle-age-in-message: CHANGES_REQUIRED.** In mốc đóng nến ở tương lai
  (+1 interval); tuổi nến không phản ánh nến thực sự được phân tích khi gửi
  từ cache.

## Chỉ dẫn cho Worker (Phase 4 — fix loop)

Chỉ fix đúng các issue trong 2 file review trên, theo thứ tự:
ISSUE-1 → ISSUE-2 → ISSUE-5 → ISSUE-3 → ISSUE-4 → minor M1-M4 (nếu tiện).
Sau khi fix, cập nhật result.md của subtask 03 và 04 với evidence mới,
trong đó BẮT BUỘC có output reproduction: setup SHORT USD/CAD entry 1.41657 /
TP1 1.41597, fresh price 1.41474 → bị loại kèm reason.
