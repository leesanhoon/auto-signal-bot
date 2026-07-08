# Shared context - SMC parallel system

## Files can doc truoc khi code

- `src/charts/index.ts`
- `src/charts/deterministic-pipeline.ts`
- `src/charts/chart-config-env.ts`
- `src/charts/chart-types.ts`
- `src/charts/positions-repository.ts`
- `src/shared/telegram.ts`
- `src/charts/ohlc-provider.ts`
- `src/charts/signal-assembly.ts`
- `supabase/migrations/*open_positions*`
- `supabase/migrations/*pending_orders*`
- `supabase/migrations/*performance_tracking*`

## Constraints quan trong

1. Khong pha luong Volman hien tai.
2. Khong dung AI vision cho SMC MVP neu khong that su can.
3. Moi strategy phai co metadata ro rang xuyen suot tu signal -> DB -> Telegram -> reporting.
4. Dedupe position/pending phai theo `pair + strategy`, khong chi theo `pair`.
5. `shadow` la concept cu cho engine comparison, khong duoc tai su dung de bieu dien `volman + smc`.

## Dinh huong implementation

- Prefer tao abstraction `strategyKey` nhu `volman | smc`
- Reuse `AnalysisResult`, `PairSummary`, `TradeSetup` neu hop ly, nhung can mo rong metadata
- SMC nen co pipeline rieng, vi du `src/charts/smc-pipeline.ts`
- Tach detection primitives de de test:
  - swing detection
  - structure break
  - liquidity sweep
  - order block / FVG
  - setup scoring

## Dinh huong Telegram

- Header can neutral, khong hardcode Bob Volman
- Message nen hien:
  - strategy name
  - timeframe bias / execution timeframe neu la SMC
  - ly do setup ngan gon va machine-readable vua du

## Dinh huong testing

- Unit tests cho tung primitive SMC
- Integration test cho pipeline SMC tu OHLC fixture -> `AnalysisResult`
- Regression test cho runtime song song Volman + SMC
- Regression test cho repository strategy-aware dedupe
