# Task 02 - Implement off-window Telegram heartbeat / cached analysis fallback

## Muc tieu

Sua flow runtime de khi scanner chay ngoai close window H4 van co thong diep Telegram hieu duoc he thong dang song, uu tien gui du lieu phan tich chart cache gan nhat neu phu hop.

## File du kien can sua

- `src/charts/index.ts`
- `src/charts/chart-cache-repository.ts`
- Co the them helper moi trong `src/charts/` hoac `src/shared/`
- Neu can, sua `src/shared/telegram.ts`

## Yeu cau functional

1. **Manual run ngoai close window**
   - Neu co latest cached analysis hop le cho cung `engineMode` -> gui ket qua do len Telegram.
   - Neu khong co cache -> gui heartbeat/no-analysis message de user biet scanner da chay.

2. **Auto run ngoai close window**
   - Van giu check open trades + pending orders.
   - Neu khong co event trade/pending nao da gui thong bao -> gui heartbeat/no-analysis message.

3. **Cached analysis fallback**
   - Neu load cache tu DB va `screenshots: []`, van phai gui duoc summary/setup text.
   - Thong diep can phan biet ro:
     - cache result cua candle da dong gan nhat
     - heartbeat khong co phan tich moi

4. **Engine mode awareness**
   - Khong reuse nham cache giua `ai` / `deterministic` / `shadow`.
   - Neu them latest-cache query, phai loc theo suffix `:engineMode` hoac contract tuong duong.

5. **Telegram spam control**
   - Khong de 1 lan run gui ca heartbeat va cac thong bao event trade/pending theo cach lap vo nghia.
   - Neu da gui ket qua phan tich hoac gui event chinh, heartbeat phai duoc suppress.

## De xuat ky thuat

- Co the them helper load latest cache:
  - `loadLatestChartAnalysisCache(engineMode: ChartEngineMode): Promise<{ candleKey: string; result: AnalysisResult } | null>`
- Co the them `RunContext`:
  - `manual` vs `auto`
- Co the them `sendHeartbeat` / `buildHeartbeatMessage`
- Co the them 1 co de theo doi trong run hien tai:
  - `hasSentPrimaryNotification`
  - `hasSentTradeLifecycleNotification`

## Khong lam

- Khong doi logic OHLC cache.
- Khong doi deterministic engine logic.
- Khong doi threshold setup hien co, tru khi can de gui text no-setup.

## Verification

Bat buoc:

```bash
npm run test -- --run
npm run build
```

Neu co the, verify tay:

```bash
$env:CHART_ENGINE_MODE='deterministic'; npm run analyze
```

Ghi ket qua vao `result.md`.
