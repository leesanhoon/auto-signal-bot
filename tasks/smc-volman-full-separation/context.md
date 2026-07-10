# Context dùng chung cho mọi subtask — smc-volman-full-separation

Đọc `tasks/smc-volman-full-separation/plan.md` trước khi làm bất kỳ subtask nào — plan có bản đồ hiện trạng đầy đủ và kiến trúc target.

## Quy tắc chung cho mọi subtask

1. **Không xoá bảng DB cũ** (`open_positions`, `pending_orders`, `chart_analysis_cache`) trừ khi task nói rõ (chỉ subtask `10-rewire-entrypoints-and-cleanup` được xoá, và chỉ sau khi build+test pass).
2. **Không sửa file ngoài danh sách "Files được phép sửa/tạo"** trong task.md của bạn.
3. **Không xoá file cũ** (ví dụ `position-engine.ts`, `positions-repository.ts`, `chart-config-env.ts`, `telegram.ts`, `charts.config.ts`, `chart-types.ts`) cho tới subtask `10-rewire-entrypoints-and-cleanup` — vì các entrypoint hiện tại (`index.ts`, `smc-index.ts`) vẫn import các file cũ này cho tới khi task 10 rewire xong. Nếu xoá sớm, build sẽ fail vì import cũ vẫn còn.
4. Mọi module mới bạn tạo phải là **bản sao/refactor của module cũ, KHÔNG thêm feature mới, KHÔNG đổi hành vi nghiệp vụ hiện có** (giữ nguyên logic tính toán, nguyên field, nguyên tên cột SQL — chỉ đổi tên bảng/tên file/tên hàm theo hậu tố `-volman`/`-smc` như plan mô tả).
5. Naming convention bắt buộc:
   - File Volman: `<ten-cu>-volman.ts` (ví dụ `position-engine-volman.ts`)
   - File SMC: `<ten-cu>-smc.ts` (ví dụ `position-engine-smc.ts`)
   - Bảng DB Volman: `<ten_bang_cu>_volman` (ví dụ `open_positions_volman`)
   - Bảng DB SMC: `<ten_bang_cu>_smc` (ví dụ `open_positions_smc`)
6. Sau khi sửa xong, chạy:
   ```bash
   npm run build
   npm run test
   ```
   Dán full output (hoặc summary số pass/fail thật) vào `result.md`. Nếu build/test fail và bạn không sửa được vì lý do ngoài scope task này (ví dụ phụ thuộc subtask khác chưa xong) → ghi `blocked.md`, không tự ý sửa file ngoài scope để "cho qua".
7. Test mirror: mọi file mới ở `src/charts/xxx-volman.ts` / `xxx-smc.ts` phải có test tương ứng ở `tests/charts/xxx-volman.test.ts` / `xxx-smc.test.ts`. Nếu test cũ (`tests/charts/xxx.test.ts`) test chung cả 2 hệ, tách nó thành 2 file test mới tương ứng — KHÔNG xoá test cũ cho tới task 10 (vì file cũ `xxx.ts` vẫn tồn tại tới lúc đó).
8. Migration SQL: đặt trong `supabase/migrations/`, tên file dạng `YYYYMMDDHHMMSS_<mo_ta>.sql`, timestamp PHẢI lớn hơn migration mới nhất hiện có trong thư mục đó (kiểm tra bằng lệnh liệt kê thư mục trước khi đặt tên).

## Bản đồ hiện trạng field/hàm quan trọng (tránh phải đọc lại toàn bộ code)

### `src/charts/chart-types.ts` hiện tại
- `TradeSetup`: có field chung Volman (`emaTouch`, `entryCondition`, `currentPriceContext`, `orderType`, `autoTracked`, `chartFallbackUsed`, `ruleTrace`) và field chỉ SMC (`grade`, `score`, `market`, `session`, `sessionLabel`, `entryZone`, `stopLossDistance`, `takeProfit3`, `takeProfitAllocations`, `liquidityTargets`, `caution`, `capitalManagement`). Field chung thật sự cho cả 2: `pair`, `direction`, `setup`, `primaryTimeframe`, `reasons`, `risks`, `confidence`, `entry`, `stopLoss`, `takeProfit1`, `takeProfit2`, `riskReward`, `summary`, `sourceCharts`, `telegramChart`, `lastPrice`, `detectionSource`.
- `PairSummary`, `PendingOrder`, `AnalysisResult`, `AnalysisStats` tương tự dùng chung cho cả 2 nhưng không có field khác biệt lớn — vẫn phải tách thành 2 type namespace riêng theo yêu cầu "không dùng chung type nghiệp vụ", nhưng nội dung field ban đầu giữ nguyên (copy).
- `ChartTimeframe`, `ChartConfig`, `ChartOrderType`, `CandleRangeStats`, `ScreenshotResult`, `ChartAnalysisSource` — đây là type thuần data/schema chart, KHÔNG có nhánh nghiệp vụ khác nhau giữa 2 hệ → giữ trong `chart-types-common.ts`.

### `src/charts/position-engine.ts` hiện tại (đã đọc đầy đủ ở review trước)
Có sẵn `SignalSystem`/`deriveSignalSystem` (thêm ở fix trước để dedup theo cột `system` — SẼ BỊ LOẠI BỎ vì giờ đã tách bảng, không cần derive system nữa: file Volman luôn implicit "volman", file SMC luôn implicit "smc").
Các hàm còn lại: `getConfiguredMinRiskRewardRatio`, `getConfiguredMinRiskRewardRatioForPattern`, `getConfiguredTp1ClosePercent`, `calculateRiskRewardPlan`, `validateTradeSetupForOpen`, `buildOpenPositionInsertRow`, `deriveManagementPatch` — copy y nguyên vào cả 2 bản, bỏ field `system`/`detectionSource` check trong `buildOpenPositionInsertRow` (không cần cột `system` trong row insert nữa vì bảng đã tách).

### `src/charts/positions-repository.ts` hiện tại
Các hàm: `saveOpenPosition`, `buildPendingOrderInsertRow`, `savePendingOrder`, `loadPendingOrders`, `updatePendingOrder`, `findOpenPositionIdByPair`, `loadOpenPositions`, `loadClosedPositions`, `updatePositionDecision`, `buildPositionManagementPatch`, `closePosition`. Copy y nguyên vào cả 2 bản, đổi:
- `.from("open_positions")` → `.from("open_positions_volman")` hoặc `.from("open_positions_smc")`
- `.from("pending_orders")` → tương tự
- Bỏ `.eq("system", deriveSignalSystem(setup))` trong dedup query (không cần nữa vì bảng đã tách riêng theo hệ)
- Bỏ field `system: deriveSignalSystem(setup)` trong `buildOpenPositionInsertRow`/`buildPendingOrderInsertRow`

### `src/charts/chart-cache-repository.ts` hiện tại
Bảng `chart_analysis_cache`, cột `candle_key` (dạng `<candleBaseKey>:<cacheLabel>:<timeframeMode>[:<primaryTimeframe>]`), cột `result` (JSONB). Hàm: `saveChartAnalysisCache`, `loadChartAnalysisCache`, `loadLatestChartAnalysisCache`, `isValidAnalysisResult`, `SETUP_FIELD_CHECKS`. Copy y nguyên vào cả 2 bản, đổi `.from("chart_analysis_cache")` → `.from("analysis_cache_volman")` / `.from("analysis_cache_smc")`. Vì bảng đã tách theo hệ, không cần suffix `:smc`/`:deterministic` trong `candle_key` nữa nhưng **KHÔNG bắt buộc đổi format key trong task này** (out of scope — chỉ đổi tên bảng, giữ nguyên format key hiện có để tránh phá cache logic khác đang phụ thuộc `ilike` suffix match ở `loadLatestChartAnalysisCache`).

### `src/charts/chart-config-env.ts` hiện tại
Đã đọc đầy đủ. Hàm chung cho cả 2 (copy vào cả 2 bản, giữ tên hàm y nguyên vì các file gọi khác chưa đổi tên gọi cho tới task 10):
`getConfiguredChartEngineMode`, `getConfiguredChartSignalConfidenceThreshold`, `getConfiguredChartTimeframeMode`, `getConfiguredChartPrimaryTimeframe`, `getConfiguredPendingOrderExpiryRuns`, `getConfiguredChartRunContext`, `shouldUseLatestCacheForManualRun`, `shouldSendHeartbeatOutsideCloseWindow`, `shouldSendHeartbeatOnManualRun`.
Hàm/type CHỈ giữ ở bản SMC: `getConfiguredSmcSignalFreshnessCandles`, `getConfiguredSmcMinSignalConfidence`.
Hàm/type BỎ HẲN ở cả 2 bản (không copy): `ChartTradingSystem`, `getConfiguredChartTradingSystem` (không còn cần chọn hệ runtime vì 2 entrypoint đã cố định hệ).

### `src/shared/telegram.ts` hiện tại
File lớn (~750+ dòng gộp cả API thô lẫn business logic). Phân lớp:
- **API thô (giữ chung ở `shared/telegram-client.ts`):** `sendMessage`, `sendPhoto`, `sendDocument`, `telegramNotifier`, `notifyError` (nếu không chứa nhánh business logic riêng hệ — kiểm tra khi đọc, nếu `notifyError` chỉ format lỗi chung chung thì giữ chung).
- **Business logic (tách riêng `telegram-volman.ts`/`telegram-smc.ts`):** `buildSmcSignalMessage`, `buildHeartbeatMessage`, `buildPositionDecisionMessage`, `buildPerformanceReportMessage`, `sendAllAnalyses` (hàm này branch theo `deliveryContext.systemLabel`/`setup.detectionSource` để chọn label — khi tách, mỗi bản chỉ còn 1 nhánh cố định, không cần branch nữa).

## Danh sách file hoàn chỉnh trong `src/charts/` (tham chiếu nhanh, không cần liệt kê lại)
```
performance-report-runner.ts, forex-backtest.ts, forex-backtest-runner.ts, performance-tracking.ts,
analyzer.ts, charts.config.ts, check-open-trades-runner.ts, check-pending-orders-runner.ts,
indicators.ts, position-decision.ts, setup-backtest-runner.ts, setup-backtest.ts, setup-resolver.ts,
setup-sb-runner.ts, setup-types.ts, setups/*.ts, signal-assembly.ts, test-analyze.ts,
deterministic-pipeline.ts, chart-cache-repository.ts, chart-types.ts, chart-cache.ts, screenshot.ts,
smc/*.ts, ohlc-cache-repository.ts, ohlc-provider.ts, smc-backtest.ts, smc-backtest-runner.ts,
position-engine.ts, positions-repository.ts, index.ts, smc-index.ts, chart-config-env.ts
```
Các file KHÔNG nằm trong scope tách (không đụng vào, chúng vốn đã per-system hoặc thuần data-fetch):
`deterministic-pipeline.ts`, `setups/*.ts`, `setup-*.ts`, `indicators.ts`, `signal-assembly.ts` (đều là Volman-only, đã ở đúng chỗ), `smc/*.ts` (đều là SMC-only, đã đúng chỗ), `analyzer.ts` (`buildChartAnalysisCacheKey` — kiểm tra ở task 06 xem có chứa logic riêng hệ không), `chart-cache.ts` (helper thời gian nến, thuần kỹ thuật không nghiệp vụ — giữ chung), `screenshot.ts` (`findChartForPair`, `fetchCandleRangeStats` — thuần orchestration OHLC, giữ chung), `ohlc-provider.ts`, `ohlc-cache-repository.ts` (data layer, giữ chung).
