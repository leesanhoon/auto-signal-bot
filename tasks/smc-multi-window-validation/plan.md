# Plan: Multi-window validation cho SMC filter (setup/grade/pair)

Task-id: `smc-multi-window-validation`
Ngày: 2026-07-11
Lead: Claude
Tiền đề: `smc-followups` DONE (xem `tasks/smc-followups/done.md`). Backtest đã: hết look-ahead, có partial exit + fee, pin được khung thời gian cố định (`BACKTEST_END_TIME`), in được `bySetup`/`byGrade`.

## Bối cảnh

Task 04 của `smc-followups` phân tích 1 snapshot duy nhất (`2026-07-08T00:00:00Z`) và kết luận: H4 có edge dương tổng thể (+0.33 avgRR), `SMC_FVG_CONTINUATION` nên loại, M15 không có edge. Nhưng chính Worker và Lead đều lưu ý: **1 snapshot không đủ để tin** — cần nhiều window khác nhau, chỉ giữ lại setup/grade/pair nào dương ở đa số window (voting), tránh overfitting vào 1 giai đoạn thị trường ngẫu nhiên.

## Mục tiêu

Chạy thêm 4 pinned window mới (cách nhau ~2 tuần, đủ xa để mẫu M15 không trùng dữ liệu), gộp với window đã có (`2026-07-08`) thành 5 window, áp dụng "voting": setup/grade/pair chỉ được coi là có edge nếu RR dương ở **đa số window có đủ mẫu** (>= 3 trong 5, với ngưỡng mẫu tối thiểu mỗi window).

## 5 window pinned (dùng `BACKTEST_END_TIME`)

| # | End time | Ghi chú |
|---|---|---|
| 1 | `2026-07-08T00:00:00Z` | Đã có sẵn — tái dùng `tasks/smc-followups/04-filter-analysis/m15-pinned.json` và `h4-pinned.json`, KHÔNG chạy lại |
| 2 | `2026-06-24T00:00:00Z` | Mới |
| 3 | `2026-06-10T00:00:00Z` | Mới |
| 4 | `2026-05-27T00:00:00Z` | Mới |
| 5 | `2026-05-13T00:00:00Z` | Mới |

Lưu ý: H4 với `BACKTEST_BARS=1000` phủ ~166 ngày lịch sử — các window H4 sẽ **overlap dữ liệu** lẫn nhau (không tránh được vì window cách nhau 2 tuần nhưng mỗi window nhìn lại ~5.5 tháng). M15 với 1000 bars chỉ phủ ~10.4 ngày nên 5 window M15 gần như không trùng dữ liệu — độc lập thật. Ghi rõ giới hạn này trong kết luận cuối, không che giấu.

## Subtasks

| # | Subtask | Việc chính | Phụ thuộc |
|---|---------|-----------|-----------|
| 01 | run-additional-windows | Chạy M15+H4, bars=1000, cho 4 window mới (#2-5), lưu 8 file JSON | — |
| 02 | aggregate-and-vote | Gộp 5 window (1 có sẵn + 4 mới), áp voting rule, viết khuyến nghị filter cuối cùng | 01 |

Không sửa code nguồn ở cả 2 subtask — chỉ chạy lệnh có sẵn và phân tích. Không commit.

## Voting rule (Lead quyết định, Worker áp dụng đúng, không tự đổi)

Cho một đối tượng X (setup, grade, hoặc pair) và một window W:

- **Valid vote** nếu số `trades` của X trong W >= ngưỡng tối thiểu:
  - Setup/grade: ngưỡng 15 trades/window.
  - Pair: ngưỡng 8 trades/window.
- Nếu KHÔNG đủ ngưỡng → window đó không tính (không phải phiếu chống, là "thiếu dữ liệu").
- X **qualify (có edge)** nếu: có >= 3 valid votes trong 5 window, VÀ trong số valid votes đó, số window có `avgRiskReward > 0` chiếm đa số (> 50%).
- X bị **loại rõ ràng** nếu có >= 3 valid votes và đa số valid votes có `avgRiskReward <= 0`.
- X **chưa đủ dữ liệu kết luận** nếu có < 3 valid votes trên toàn bộ 5 window — ghi rõ, không xếp vào giữ hay loại.

## Acceptance criteria

- 8 file JSON mới (4 window × 2 timeframe) lưu trong `tasks/smc-multi-window-validation/01-run-additional-windows/`.
- `tasks/smc-multi-window-validation/02-aggregate-and-vote/result.md` có:
  - Bảng voting đầy đủ cho bySetup, byGrade, và top/bottom pairs, đúng rule ở trên.
  - Danh sách setup/grade/pair "qualify", "loại", "chưa đủ dữ liệu" — tách riêng cho M15 và H4 (không gộp 2 timeframe).
  - Khuyến nghị cuối cùng: có nên áp filter vào production chưa, filter cụ thể là gì nếu có.
  - Mục "giới hạn" nêu rõ H4 overlap dữ liệu giữa các window.
- `npm run build` + `npm run test` pass ở bước kiểm tra cuối (đảm bảo không ai lỡ tay sửa code trong lúc phân tích).

## Ngoài scope

- Không áp filter vào `smc-config-env.ts` hay pipeline live — đó là quyết định của user sau khi xem kết quả, sẽ là task riêng nếu được yêu cầu.
- Không thêm forward-test / paper trading — ngoài phạm vi backtest.
