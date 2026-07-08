# Task 02 - Chuyen trading chart scan sang deterministic-only

## Muc tieu

Trading scan production khong con goi AI vision/text. `npm run analyze` phai chay numeric engine thuan.

## File du kien can sua

- `src/charts/index.ts`
- `src/charts/chart-config-env.ts`
- `src/charts/chart-types.ts`
- `src/charts/analyzer.ts` hoac tach/xoa phan AI-only neu can
- `src/shared/telegram.ts`
- tests lien quan trong `tests/charts`

## Yeu cau

1. Runtime
   - Bo hoac deprecate `ChartEngineMode = "ai" | "shadow"`
   - Default engine la deterministic-only
   - Khong capture screenshot cho analysis neu deterministic pipeline khong can

2. Cache key
   - Cache key khong con phu thuoc vao AI/shadow
   - Tranh doc lai cache cu tao tu AI neu contract output khong dam bao

3. Telegram
   - Thay wording "tu AI" bang "tu thuat toan" / "tu cache"
   - Header khong lam user nghi ket qua den tu model

4. Tests
   - Update tests dang ky vong AI/shadow
   - Them regression de `analyzeCurrentWindow`/runtime khong goi `analyzeAllCharts`

## Khong lam

- Chua xu ly open/pending fallback AI trong task nay neu tach sang task 03.
- Chua implement SMC neu chua co task rieng.

## Verification

```bash
npm run test -- --run tests/charts
npm run build
rg -n "callOpenRouter|AI_VISION_MODEL|shadow|Analyzing charts \\(AI\\)|từ AI" src/charts src/shared/telegram.ts tests/charts
```
