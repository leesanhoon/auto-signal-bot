# Task 03 - Implement SMC deterministic detection engine tu OHLC

## Muc tieu

Tao 1 pipeline SMC moi doc OHLC va tra ve `AnalysisResult` theo contract cua repo.

## Dinh huong ky thuat

Implement theo cac primitive nho, de test doc lap:

1. Swing detection
2. BOS / CHOCH detection
3. Liquidity sweep detection
4. Displacement + order block detection
5. FVG detection
6. Setup scoring / confidence assembly
7. Build `TradeSetup` + `PairSummary`

## File du kien can them/sua

- Them file moi trong `src/charts/`, vi du:
  - `src/charts/smc-pipeline.ts`
  - `src/charts/smc-types.ts`
  - `src/charts/smc-structure.ts`
  - `src/charts/smc-liquidity.ts`
  - `src/charts/smc-zones.ts`
  - `src/charts/smc-signal-assembly.ts`
- Co the tai su dung:
  - `src/charts/ohlc-provider.ts`
  - `src/charts/chart-types.ts`
  - `src/charts/position-engine.ts`

## Rules MVP can co

1. HTF bias
   - Dung `H4` de xac dinh bullish / bearish bias
   - Bias uu tien dua tren BOS / CHOCH da confirm

2. LTF trigger
   - Dung `M15` de tim entry trigger
   - Chi tao setup khi cung huong voi HTF bias

3. Liquidity + zone
   - Uu tien setup khi co liquidity sweep va gia quay lai order block hoac FVG hop le

4. Risk plan
   - Entry, SL, TP1, TP2 phai tinh duoc
   - `riskReward` khong duoc rong neu setup hop le

5. Output
   - `TradeSetup.reasons` phai giai thich duoc: bias, BOS/CHOCH, sweep, zone, entry trigger
   - `risks` phai chi ra khi setup yeu

## Khong lam

- Khong dung AI model cho task nay
- Khong can chup screenshot TradingView neu khong can cho Telegram fallback
- Khong co auto-execution broker

## Dau ra mong muon trong `result.md`

- cac file moi da them
- primitive nao da implement
- contract output cua SMC pipeline
- limitation con lai cua MVP

## Verification

```bash
npm run test -- --run
npm run build
```
