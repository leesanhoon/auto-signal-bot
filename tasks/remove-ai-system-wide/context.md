# Shared context - remove AI system-wide for trading and lottery

## Existing audit

Da co audit chart AI tai:

- `tasks/remove-ai-from-chart-analysis/01-audit-all-ai-dependencies/result.md`

Task moi nay mo rong scope sang lottery va shared cleanup.

## Trading AI call paths can thay the

- `src/charts/index.ts`
- `src/charts/analyzer.ts`
- `src/charts/position-decision.ts`
- `src/charts/check-open-trades-runner.ts`
- `src/charts/check-pending-orders-runner.ts`
- `src/charts/chart-config-env.ts`
- `src/shared/telegram.ts`

Trading da co algorithm foundation:

- `src/charts/deterministic-pipeline.ts`
- `src/charts/setups/*.ts`
- `src/charts/setup-sb-runner.ts`
- `src/charts/signal-assembly.ts`
- `src/charts/ohlc-provider.ts`
- `src/charts/position-engine.ts`

## Lottery AI call paths can thay the

- `src/lottery/lottery-ai-predict.ts`
- `src/lottery/lottery-ensemble-predict.ts`
- `src/lottery/lottery-predict-runner.ts`
- `src/lottery/lottery-predict-resync-index.ts`

Lottery da co algorithm foundation:

- `src/lottery/lottery-stats-predict.ts`
- `src/lottery/lottery-regression-predict.ts`
- `src/lottery/lottery-format.ts`
- `src/lottery/lottery-predictions-repository.ts`

## Definition of done

- Trading/lottery production code khong import `shared/openrouter`, `shared/ai-model-fallback`, hoac `shared/ai-usage`.
- Trading/lottery production env khong can `OPENROUTER_API_KEY`, `AI_VISION_MODEL`, `AI_TEXT_MODEL`.
- Tests cho trading/lottery khong mock model calls.
- Docs noi ro algorithm-only va ghi limitation ro rang.

## Important note

Betting flow hien tai cung co AI usage. Neu Lead quyet dinh dung "toan he thong" theo nghia tuyet doi, can them task xoa/thay AI cho betting. Neu scope chi la 2 chuc nang user neu ra, betting duoc ghi ngoai scope trong final review.
