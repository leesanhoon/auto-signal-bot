# Task 03 - Them test regression va cap nhat env docs cho timeframe mode

## Muc tieu

Khoa behavior moi bang test va cap nhat `.env.example` de production co the cau hinh `single + M15`.

## File du kien can sua

- `tests/charts/...`
- `.env.example`

## Yeu cau test

Them/bo sung test cho:

1. `getConfiguredChartTimeframeMode()` fallback `multi`
2. `getConfiguredChartPrimaryTimeframe()` fallback `M15`
3. Runtime chart selection:
   - `multi` -> co `D1/H4/M15`
   - `single + M15` -> chi con `M15`
4. Cache analysis key phan biet duoc:
   - `multi`
   - `single:M15`
   - `single:H4`

Neu de test runtime end-to-end qua `index.ts` la qua nang, co the tach helper de unit test.

## Yeu cau docs

Cap nhat `.env.example` them:

- `CHART_TIMEFRAME_MODE=multi`
- `CHART_PRIMARY_TIMEFRAME=M15`

Va comment ngan:

- `multi`: quet D1/H4/M15 cung luc
- `single`: chi quet timeframe duoc chon
- production target hien tai: `single + M15`

## Verification

```bash
npm run test -- --run
npm run build
```

Ghi ket qua vao `result.md`.
