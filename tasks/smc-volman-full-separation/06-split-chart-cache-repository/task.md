# Task 06 — Tách chart-cache-repository.ts theo hệ

Đọc `tasks/smc-volman-full-separation/plan.md` và `tasks/smc-volman-full-separation/context.md` trước.

Phụ thuộc: Subtask 01 (bảng `analysis_cache_volman`/`analysis_cache_smc`), Subtask 02 (`chart-types-volman.ts`/`chart-types-smc.ts`), và Subtask 03 (type `ChartEngineMode`/`ChartTimeframeMode` từ `volman-config-env.js`/`smc-config-env.js`) phải xong trước. Có thể làm song song với task 05.

**⚠️ Cập nhật sau self-review:** `src/charts/chart-cache-repository-volman.ts` và `-smc.ts` **đã tồn tại sẵn** trong working tree. Đọc trước khi làm — nếu đã đúng theo spec dưới đây thì chỉ cần đối chiếu và ghi lại vào `result.md`, không viết lại.

## Files được phép sửa/tạo
- Tạo mới: `src/charts/chart-cache-repository-volman.ts`
- Tạo mới: `src/charts/chart-cache-repository-smc.ts`
- Tạo mới: `tests/charts/chart-cache-repository-volman.test.ts`
- Tạo mới: `tests/charts/chart-cache-repository-smc.test.ts`
- KHÔNG sửa/xoá `src/charts/chart-cache-repository.ts` gốc.

## Nội dung copy vào CẢ HAI file

Từ `src/charts/chart-cache-repository.ts`, copy toàn bộ: `saveChartAnalysisCache`, `ChartAnalysisCacheRow` type, `SETUP_FIELD_CHECKS`, `isValidAnalysisResult`, `toCachedAnalysisResult`, `loadChartAnalysisCacheRow`, `loadChartAnalysisCache`, `loadLatestChartAnalysisCache`.

## Thay đổi so với bản gốc

1. `chart-cache-repository-volman.ts`:
   - Import type `ChartEngineMode, ChartTimeframeMode` từ `./volman-config-env.js`.
   - Import type `ChartTimeframe` từ `./chart-types-common.js`.
   - Import type `AnalysisResult, AnalysisStats, TradeSetup` từ `./chart-types-volman.js`.
   - Mọi `.from("chart_analysis_cache")` → `.from("analysis_cache_volman")`.
   - Giữ nguyên format `candle_key` và logic suffix match trong `loadLatestChartAnalysisCache` (KHÔNG đổi — out of scope, xem context.md).
2. `chart-cache-repository-smc.ts`: tương tự, dùng `./smc-config-env.js`, `./chart-types-smc.js`, bảng `.from("analysis_cache_smc")`.
3. Giữ nguyên 100% logic validate schema (`SETUP_FIELD_CHECKS`, `isValidAnalysisResult`) ở cả 2 file — đây là schema check chung cho cấu trúc `TradeSetup`, field list giống nhau ở bước này (dọn field thừa là việc của task 10 nếu cần).

## Bước — Test

Đọc `tests/charts/chart-cache-repository.test.ts` hiện có (nếu tồn tại), copy pattern mock Supabase vào 2 file test mới, đổi assertion `.from("chart_analysis_cache")` → `.from("analysis_cache_volman")`/`.from("analysis_cache_smc")` tương ứng. Giữ nguyên các test case validate schema.

## Ngoài phạm vi (KHÔNG làm)
- Không sửa `chart-cache-repository.ts` gốc.
- Không sửa `index.ts`/`smc-index.ts` (task 10).
- Không đổi format `candle_key`.

## Verification
```bash
npm run build
npm run test
```
Ghi kết quả vào `tasks/smc-volman-full-separation/06-split-chart-cache-repository/result.md`.
