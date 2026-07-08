# Task 01 - Chot contract runtime cho SMC chay song song voi he thong hien tai

## Muc tieu

Phan tich code hien tai va chot 1 contract ro rang cho:

- strategy runtime (`volman`, `smc`, `volman+smc`)
- phan biet `strategy mode` voi `engine mode`
- SMC MVP rules se implement trong task sau

Task nay uu tien phan tich/decision, chua can implement code neu khong can.

## File can doc ky

- `src/charts/index.ts`
- `src/charts/chart-config-env.ts`
- `src/charts/deterministic-pipeline.ts`
- `src/charts/chart-types.ts`
- `src/shared/telegram.ts`
- `tasks/add-smc-parallel-system/plan.md`
- `tasks/add-smc-parallel-system/context.md`

## Yeu cau dau ra

Ghi `result.md` voi:

1. Contract runtime de xuat
   - env nao dung de chon strategy
   - gia tri hop le
   - default nao de giu backward compatibility

2. Boundary giua cac concept
   - `engine mode`
   - `strategy`
   - `timeframe mode`
   - `run context`

3. SMC MVP ruleset
   - HTF bias lay nhu the nao
   - LTF entry trigger lay nhu the nao
   - nhung primitive nao vao MVP
   - nhung primitive nao chua vao MVP

4. Metadata toi thieu can them vao `TradeSetup` / `PairSummary`
   - vi du `strategyKey`, `strategyLabel`, `biasTimeframe`, `executionTimeframe`

5. Rui ro / luu y
   - cach tranh nham `shadow` voi `parallel strategies`
   - cach giu backward compatibility cho Volman

## Khong lam

- Chua sua DB schema o task nay
- Chua implement SMC detector
- Chua doi Telegram formatting

## Verification

Khong bat buoc chay test neu chi phan tich contract.
