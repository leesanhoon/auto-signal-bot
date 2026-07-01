# Roadmap — auto-signal-bot

Nguồn: [docs/plan-for-app.md](../plan-for-app.md). Mỗi phase dưới đây là một file subtask độc lập.

| #   | Phase                                                      | Ưu tiên    | Trạng thái |
| --- | ---------------------------------------------------------- | ---------- | ---------- |
| 01  | [Testing tự động](01-testing.md)                           | Cao        | done       |
| 02  | [Structured logging](02-structured-logging.md)             | Cao        | done       |
| 03  | [Webhook idempotency](03-webhook-idempotency.md)           | Cao        | done       |
| 04  | [Rate limiting chủ động](04-rate-limiting.md)              | Cao        | done       |
| 05  | [Position decision engine](05-position-decision-engine.md) | Trung bình | done       |
| 06  | [Performance tracking](06-performance-tracking.md)         | Trung bình | done       |
| 07  | [Backtesting](07-backtesting.md)                           | Trung bình | done       |
| 08  | [Cost & observability](08-cost-observability.md)           | Trung bình | done       |
| 09  | [Lệnh /stats](09-stats-command.md)                         | Trung bình | done       |
| 10  | [Mở rộng tính năng](10-feature-expansion.md)               | Thấp       | done       |

## Cách dùng

- Cập nhật cột "Trạng thái" (todo / in-progress / done) khi bắt đầu/hoàn thành mỗi phase.
- Mỗi file phase có checklist + acceptance criteria riêng, đọc trực tiếp file đó để làm, không cần đọc lại `plan-for-app.md`.
- Có thể làm song song các phase trong cùng nhóm ưu tiên nếu không phụ thuộc nhau (vd 01–04 độc lập với nhau).
