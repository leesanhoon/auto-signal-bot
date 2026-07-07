# Task 01 - Them runtime config cho single-timeframe vs multi-timeframe

## Muc tieu

Them helper doc env de runtime biet dang chay:

- `multi-timeframe`
- hay `single-timeframe`

Va neu la `single`, timeframe nao duoc chon (`M15` la target production hien tai).

## File du kien can sua

- `src/charts/chart-config-env.ts`
- Co the can type moi trong `src/charts/chart-types.ts`
- `.env.example` co the de task 03 cap nhat neu ban muon tach rieng

## Yeu cau

1. Them config helper moi, vi du:

```ts
export type ChartTimeframeMode = "multi" | "single";

export function getConfiguredChartTimeframeMode(): ChartTimeframeMode
export function getConfiguredChartPrimaryTimeframe(): ChartTimeframe
```

2. Validation:

- `CHART_TIMEFRAME_MODE` chi nhan `multi` hoac `single`
- `CHART_PRIMARY_TIMEFRAME` chi nhan `M15`, `H4`, `D1`
- fallback:
  - mode mac dinh = `multi`
  - primary timeframe mac dinh = `M15`

3. Ghi `result.md`

- helper da them
- fallback/default da chon
- file/type nao bi anh huong

## Khong lam

- Chua sua runtime capture/analyze o task nay neu khong can
- Chua doi logic Telegram

## Verification

```bash
npm run build
```
