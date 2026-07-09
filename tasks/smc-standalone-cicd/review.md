# Review: SMC Standalone CI/CD (subtasks 01-03)

## Phương pháp review

- Đọc toàn bộ `src/charts/smc-index.ts` (235 dòng), đối chiếu từng phần với `plan.md`/`task.md`.
- Verify chữ ký thật `runCheckPendingOrders`/`runCheckOpenTrades` (cả 2 `Promise<number>`) khớp cách dùng trong code mới.
- Đọc diff `package.json` và toàn bộ `analyze-smc.yml` mới.
- Đọc các test case quan trọng nhất trong `tests/charts/smc-index.test.ts` (case 1, 2, 7).
- Grep xác nhận không còn tham chiếu thật nào tới Bob Volman/`analyzeAllChartsDeterministic`/`getConfiguredChartTradingSystem` trong file mới.
- Xác nhận `git status` cho thấy `src/charts/index.ts` và `.github/workflows/analyze.yml` (Bob Volman) **không bị đụng**.
- Tự chạy `npm run build` + `npm test` độc lập.

## Kết quả verify độc lập

```
npm run build   → tsc pass
npm test        → Test Files 66 passed (66), Tests 721 passed (721)
```

## Đối chiếu từng subtask

| Subtask | Đúng yêu cầu? | Ghi chú |
|---|---|---|
| 01-smc-standalone-entrypoint | ✅ | `smc-index.ts` không import `analyzeAllChartsDeterministic`/`getConfiguredChartTradingSystem`; `smcAnalysisTimeframe()` đúng công thức khớp `smc-pipeline.ts`; `runCheckPendingOrders()` gọi thật, kết quả dùng đúng trong điều kiện heartbeat (dòng 209-211); `buildSmcHeartbeatMessage` riêng, không dùng `buildHeartbeatMessage` gốc |
| 02-smc-workflow-cron | ✅ | `package.json` thêm đúng script `analyze:smc`; `analyze-smc.yml` xoá sạch 3 bước Playwright, cron `*/15 * * * 1-5`, không còn `CHART_TRADING_SYSTEM`, trỏ đúng `npm run analyze:smc` |
| 03-smc-entrypoint-tests | ✅ | 17 test case mới, cover đủ: M15 vs H4 (case 1-2), gọi đúng tham số `analyzeAllChartsSmc` (case 3), pending-order ảnh hưởng heartbeat (case 4/4b), cache hit/miss (case 5/6), **heartbeat không chứa "Bob Volman"** (case 7) — đây là 2 test cốt lõi (case 1 và case 7) đều pass |

## Điểm chấp nhận được (không phải lỗi)

- Test case 8 (error bubbling) tự nhận không thể test trực tiếp module-level catch handler (do guard `if (!process.env.VITEST)`) — đây là giới hạn cấu trúc thật, không phải worker né việc, chấp nhận được.

## Không phát hiện vấn đề nào

- `src/charts/index.ts`, `.github/workflows/analyze.yml` (Bob Volman) hoàn toàn không bị đụng — verify bằng `git status`.
- Không có nhánh rẽ `tradingSystem === "smc"` nào còn sót trong toàn bộ code mới.

## Quyết định: APPROVED

Cả 3 subtask đạt yêu cầu. SMC giờ có entrypoint + CI hoàn toàn độc lập, không kế thừa Bob Volman, cache/window đúng M15, cron phù hợp M15, không lãng phí Playwright.

## Lưu ý vận hành sau khi deploy

- Theo dõi thời gian chạy thực tế của `analyze-smc.yml` — nếu rate limit TwelveData (7 req/phút mặc định) khiến 1 lượt chạy vượt quá thời gian trước lượt kế tiếp (15 phút), cân nhắc giãn cron xuống `*/30`.
