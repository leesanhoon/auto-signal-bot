# Plan: SMC backtest follow-ups (cache key, pinned window, setup/grade breakdown, filter analysis)

Task-id: `smc-followups`
Ngày: 2026-07-10
Lead: Claude
Tiền đề: `smc-backtest-fixes` DONE, `smc-expand-and-realism` DONE (xem `tasks/smc-expand-and-realism/done.md`).

## Bối cảnh

Sau khi loại look-ahead bias và thêm partial exit + fee, baseline hiện tại: M15 avgRR âm rõ rệt (không có edge sau fee), H4 gần hoà vốn. Nhưng review cuối phát hiện 2 vấn đề làm giảm độ tin cậy của con số:

1. `src/charts/ohlc-provider.ts:103` — `cacheKey(symbol, timeframe)` không chứa số bars, nên đổi `BACKTEST_BARS` trong cùng cửa sổ cache có thể trả nhầm dữ liệu đã cache.
2. Backtest luôn lấy "N nến gần nhất tính đến hiện tại" — chạy 2 lần cách nhau vài chục phút cho kết quả khác nhau, không tái lập được, không so sánh được giữa các lần tối ưu signal.

Ngoài ra, `SmcBacktestReport` đã có sẵn field `bySetup`/`byGrade`/`bySetupStats` nhưng runner không in ra — không thể biết setup/grade nào có edge thật để lọc.

## Mục tiêu

1. Backtest tái lập được (pin khung thời gian cố định).
2. Cache không còn gây nhầm lẫn giữa các cấu hình bars khác nhau.
3. Runner in được breakdown theo setup và theo grade.
4. Dùng 3 kết quả trên để phân tích và đề xuất filter (grade nào, setup nào, pair nào nên loại) trước khi cân nhắc chạy live.

## Subtasks

| # | Subtask | File chính | Mô tả | Phụ thuộc |
|---|---------|-----------|-------|-----------|
| 01 | fix-ohlc-cache-key | `src/charts/ohlc-provider.ts` | Thêm số bars (hoặc bypass cache) vào cache key cho request backtest | — |
| 02 | pin-backtest-window | `src/charts/smc-backtest-runner.ts`, `src/charts/ohlc-provider.ts` | Cho phép backtest chạy trên khung thời gian cố định qua `BACKTEST_END_TIME` (ISO date), mặc định giữ hành vi cũ nếu không set | 01 |
| 03 | log-setup-grade-breakdown | `src/charts/smc-backtest-runner.ts` | In `bySetup` và `byGrade` ra console output, gộp theo toàn bộ pairs (không chỉ per-pair) | — |
| 04 | filter-analysis | (không sửa src, chỉ chạy + viết báo cáo) | Chạy backtest pinned window, đọc bySetup/byGrade, đề xuất filter cụ thể (grade/setup/pair nên giữ hoặc loại) | 01, 02, 03 |

01 và 03 độc lập, có thể chạy song song (2 chat Worker khác nhau). 02 cần 01 xong trước (để pin window không bị cache trộn dữ liệu). 04 cần cả ba.

## Nguyên tắc

- Không đổi logic sinh signal (`smc-pipeline.ts` và smc-* modules khác).
- Không đổi hành vi mặc định khi không set env mới — mọi thay đổi phải backward-compatible với `npm run analyze:smc` (chạy live, không phải backtest) và các workflow GitHub hiện có.
- Không commit/push.
- Mỗi task tự chạy `npm run build` + `npm run test` + backtest liên quan, ghi kết quả vào result.md.

## Acceptance criteria chung

- Build + toàn bộ test pass sau mỗi subtask.
- `npm run analyze:smc` (chạy thật, ngoài backtest) không bị ảnh hưởng bởi thay đổi cache key (01) — vẫn cache đúng như cũ cho luồng live.
- Chạy 2 lần backtest liên tiếp với cùng `BACKTEST_END_TIME` cho ra kết quả **giống hệt nhau** (proof của việc pin window hoạt động).
- Runner in được bySetup/byGrade summary cuối log.
- `tasks/smc-followups/04-filter-analysis/result.md` có đề xuất filter cụ thể kèm số liệu hỗ trợ.
