# Task 04 - Noi runtime song song va gui Telegram cho Volman + SMC

## Muc tieu

Sua orchestration de trong 1 lan run co the chay 1 hoac nhieu strategy va gui Telegram ro rang cho tung strategy.

## File du kien can sua

- `src/charts/index.ts`
- `src/charts/chart-config-env.ts`
- `src/shared/telegram.ts`
- `src/charts/deterministic-pipeline.ts`
- `src/charts/smc-pipeline.ts` (tu task 03)
- Cac helper cache/orchestration lien quan

## Yeu cau

1. Runtime strategy selection
   - doc env strategy moi
   - support:
     - chi `volman`
     - chi `smc`
     - `volman,smc`

2. Orchestration
   - lap qua tung strategy active
   - moi strategy tao `AnalysisResult` rieng
   - save cache theo strategy
   - save open/pending theo strategy

3. Telegram
   - bo hardcode "Bob Volman" khi can
   - message can hien ro strategy nao
   - setup text cua SMC nen hien bias timeframe + execution timeframe neu co
   - neu ca 2 strategy cung co signal, user van phan biet duoc message nao thuoc strategy nao

4. Heartbeat / logs
   - logs can hien runtime dang chay strategy nao
   - heartbeat/cache message neu co phai tranh mo ho giua Volman va SMC

## Dau ra mong muon trong `result.md`

- runtime moi chon strategy ra sao
- Telegram da doi header/format nhu the nao
- cache/orchestration da tach strategy ra sao
- test nao da them/chay

## Khong lam

- Khong can mo rong them strategy thu 3
- Khong can doi betting/lottery flows

## Verification

```bash
npm run test -- --run
npm run build
```
