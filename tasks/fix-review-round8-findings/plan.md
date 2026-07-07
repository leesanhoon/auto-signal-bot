# Plan - Fix review round 8 findings

## Context

Review moi nhat da xac nhan 2 van de trong flow chart scanner:

1. `src/charts/index.ts` dang build cache key 2 lan cho luong doc cache candle hien tai.
   - `main()` da tao key day du bang `buildChartAnalysisCacheKey(...)`.
   - `loadAnalysisForRun()` lai build them 1 lan nua truoc khi goi `loadChartAnalysisCache(...)`.
   - He qua: read path va save path khong con khop nhau, dan den cache miss gia tao.
   - Test hien tai trong `tests/charts/index.test.ts` dang mock theo dung hanh vi sai nay, nen regression khong bi bat.

2. `single` timeframe mode chua duoc ap dung thuc su cho deterministic engine.
   - Runtime da doc `CHART_TIMEFRAME_MODE` va `CHART_PRIMARY_TIMEFRAME`.
   - AI/screenshot path da ton trong khai niem timeframe runtime.
   - Nhưng deterministic path van hardcode H4 trong `src/charts/deterministic-pipeline.ts`.
   - He qua: log va cache key noi rang dang chay `single` M15/D1, nhung phan tich thuc te van la H4.

## Muc tieu

- Sua cache-key flow de cache candle hien tai doc/ghi cung mot key duy nhat.
- Sua deterministic runtime de ton trong `timeframeMode` + `primaryTimeframe`, it nhat cho `single` mode.
- Bo sung/sua test de bat duoc 2 regression tren.

## Subtasks

| ID | Subtask | Muc tieu |
| --- | --- | --- |
| 01 | `01-fix-cache-key-and-deterministic-timeframe/` | Sua code runtime + deterministic pipeline + test regression cho cache key va single timeframe mode |

## Verification

```bash
npm run build
npm run test -- --run
```
