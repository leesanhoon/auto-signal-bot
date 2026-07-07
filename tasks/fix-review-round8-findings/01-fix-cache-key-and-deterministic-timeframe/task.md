# Task 01 - Fix cache key duplication va deterministic single-timeframe mode

## Muc tieu

Sua 2 loi da duoc review xac nhan trong flow charts:

1. Cache key bi build 2 lan khi doc cache candle hien tai, gay cache miss gia.
2. `single` timeframe mode chua duoc deterministic engine ton trong thuc su.

Worker can sua code va test de hai loi nay khong tai phat.

## Van de 1 - Cache key bi build 2 lan (HIGH)

### Hien trang da xac nhan

Trong `src/charts/index.ts`:

- `main()` da tao `candleKey` bang `buildChartAnalysisCacheKey(...)`.
- Sau do `loadAnalysisForRun(...)` nhan gia tri nay, nhung lai tiep tuc:

```ts
const cacheKey = buildChartAnalysisCacheKey(candleKey, engineMode, timeframeMode, primaryTimeframe);
```

- Roi goi `loadChartAnalysisCache(cacheKey)`.

He qua: key doc cache bi thanh dang:

```ts
<candle-base>:<engine>:<mode>[:<primary>]:<engine>:<mode>[:<primary>]
```

trong khi key luu cache chi co 1 lop suffix.

### Yeu cau fix

1. Chon 1 contract ro rang va giu nhat quan:
   - Hoac `main()` chi tao base candle key, `loadAnalysisForRun()` tu build full key.
   - Hoac `main()` tao full key, `loadAnalysisForRun()` dung truc tiep, khong build lai.

2. Sau khi sua:
   - Luong read cache candle hien tai va save cache phai dung cung 1 key.
   - `origin.candleKey` gui xuong Telegram khi dung current-cache phai la key that da doc/ghi.

3. Sua test trong `tests/charts/index.test.ts` de no bat duoc regression that:
   - Khong duoc mock theo hanh vi sai hien tai.
   - Nen co assertion cho exact key/so lan build key hoac exact argument truyen vao `loadChartAnalysisCache(...)`.

## Van de 2 - deterministic engine chua ton trong single timeframe mode (MEDIUM)

### Hien trang da xac nhan

`src/charts/index.ts` da doc:

- `getConfiguredChartTimeframeMode()`
- `getConfiguredChartPrimaryTimeframe()`

va da dua thong tin nay vao:

- log runtime
- cache key
- AI screenshot flow

Nhung deterministic path van goi:

```ts
analyzeAllChartsDeterministic(pairs)
```

Trong `src/charts/deterministic-pipeline.ts`, engine van hardcode:

- fetch OHLC cho `"H4"`
- context timeframe = `"H4"`

Nghia la `single` + `M15`/`D1` hien tai chi doi nhan/dinh danh, khong doi behavior thuc te.

### Yeu cau fix

1. Wire deterministic engine de nhan runtime timeframe can phan tich.
   - Uu tien giai phap don gian, ro rang:
     - them tham so `primaryTimeframe` (va neu can, `timeframeMode`) vao `analyzeAllChartsDeterministic(...)`;
     - khi `single` mode thi dung timeframe duoc config;
     - khi `multi` mode can giu behavior cu, tuc H4 la primary timeframe de tranh doi semantics ngoai y muon.

2. Trong deterministic pipeline:
   - khong hardcode H4 nua cho case runtime duoc truyen vao;
   - `fetchOhlcHistory(...)`, context timeframe, va bat ky field output nao lien quan phai dong bo theo timeframe thuc te.

3. Khong mo rong scope sang redesign full multi-timeframe deterministic engine.
   - Muc tieu o day la: neu runtime noi `single D1` hoac `single M15`, deterministic phai phan tich dung timeframe do.
   - `multi` mode co the tiep tuc map ve H4 neu do la behavior cu.

## Test bat buoc

Cap nhat hoac bo sung test de cover it nhat cac diem sau:

1. Cache key regression:
   - current-cache read dung exact key da duoc tao cho run hien tai;
   - test se fail neu key bi build 2 lan.

2. Deterministic single timeframe:
   - co test xac nhan deterministic path nhan `primaryTimeframe = "M15"` (hoac `D1`) thi pipeline/fetch dung timeframe do;
   - co test xac nhan `multi` mode khong bi doi behavior ngoai y muon (neu can, van la H4).

Neu thay vi test integration o `index.test.ts` can them test don vi cho `deterministic-pipeline.ts` thi duoc, mien la regression duoc bat ro rang.

## Khong lam

- Khong doi message Telegram ngoai pham vi can thiet cho fix.
- Khong redesign cache repository schema.
- Khong redesign toan bo deterministic engine thanh multi-timeframe full.

## Verification

```bash
npm run build
npm run test -- --run
```

## Ghi ket qua

Ghi vao `result.md`:

- File/code path da sua cho van de cache key.
- File/code path da sua cho deterministic timeframe mode.
- Test nao da sua/them de bat regression.
- Ket qua `npm run build`.
- Ket qua `npm run test -- --run`.
