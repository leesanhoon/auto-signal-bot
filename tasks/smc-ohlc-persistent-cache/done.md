# Done: smc-ohlc-persistent-cache

## Kết luận
APPROVED — cả 4 subtask đúng theo `plan.md` + `task.md` tương ứng. Đã verify bằng cách đọc code thực tế (không chỉ đọc result.md) và tự chạy lại:

- `npm run build` → pass, không lỗi TypeScript.
- `npm test` → 67 test file, 737 test, pass toàn bộ.
- `git diff --stat` xác nhận đúng phạm vi: chỉ `src/charts/ohlc-provider.ts` (+13/-1) và `tests/charts/ohlc-provider.test.ts` (+90) bị sửa; các file mới đúng như plan (`src/charts/ohlc-cache-repository.ts`, `supabase/migrations/20260710000001_ohlc_candle_cache.sql`, `tests/charts/ohlc-cache-repository.test.ts`).
- Không đụng `chart_analysis_cache`, `smc-pipeline.ts`, `smc-htf-context.ts`, `smc-confluence.ts`, `charts.config.ts`, `analyze-smc.yml` — đúng ràng buộc bắt buộc trong plan.
- D1 xác nhận không gọi `loadOhlcCandleCache`/`saveOhlcCandleCache` (test + đọc code `isCacheEnabled` không bị sửa).

## Finding không chặn merge
`tests/charts/ohlc-cache-repository.test.ts:222-228` — test "trả null khi getDb() throw (fail silent)" không thực sự set up mock throw riêng, dựa vào state sót từ test trước → test yếu/gây hiểu nhầm, không phải bug production. Có thể fix sau, không cần block.

## Chưa nằm trong scope plan này (không phải thiếu sót)
- Chưa đo runtime thực tế của `analyze-smc.yml` sau khi deploy (cần chờ cron chạy thật với Supabase production).
- Không điều chỉnh `TWELVEDATA_RATE_LIMIT_RPM` hay cron cadence — đúng như "Rủi ro & lưu ý" trong `plan.md`, đây là việc riêng nếu sau khi đo vẫn còn chậm.
