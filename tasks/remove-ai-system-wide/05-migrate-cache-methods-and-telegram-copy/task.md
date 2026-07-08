# Task 05 - Doi cache/method version va Telegram copy sang algorithm-only

## Muc tieu

Dam bao du lieu cu va thong diep nguoi dung khong tron lan AI vs algorithm-only.

## File du kien can sua

- `src/shared/telegram.ts`
- `src/lottery/lottery-format.ts`
- `src/lottery/lottery-predictions-repository.ts`
- `src/lottery/lottery-predict-runner.ts`
- migrations neu can bo sung/backfill method metadata
- tests format/telegram

## Yeu cau

1. Chart Telegram
   - "tu AI" -> "tu thuat toan" hoac "tu cache"
   - "AI scanner" wording -> deterministic/algorithm scanner

2. Lottery Telegram
   - Breakdown hien `Thong ke`, `Hoi quy`, `Chu ky` neu co
   - Khong hien `AI xx%`

3. Cache/method
   - Doi method version cho prediction moi
   - Khong reuse cache cu neu cache do tao bang method co AI ma method version khong khop
   - Neu repository hien load cache theo date/region khong check method, them filter/version policy

4. Stats/dashboard
   - Neu trading/lottery khong con AI, `/stats` khong nen hien AI usage nhu metric chinh nua
   - Co the thay bang "Algorithm runs" neu da co data, hoac an dong AI usage neu null/disabled

## Verification

```bash
npm run test -- --run tests/shared tests/lottery
npm run build
rg -n "từ AI|tu AI|AI hôm nay|breakdown\\.ai|AI " src/shared src/lottery tests/shared tests/lottery
```
