# Task 02 - Noi runtime de chay single-timeframe theo config (target M15)

## Muc tieu

Sua luong runtime thuc te de khi:

- `CHART_TIMEFRAME_MODE=single`
- `CHART_PRIMARY_TIMEFRAME=M15`

thi scanner chi chay chart `M15`, thay vi luon chay bo `D1/H4/M15`.

## File du kien can sua

- `src/charts/index.ts`
- `src/charts/charts.config.ts`
- `src/charts/screenshot.ts`
- `src/charts/analyzer.ts`
- Co the them helper runtime chart selection moi trong `src/charts/`

## Yeu cau functional

1. **Chart selection**
   - `multi`: giu nguyen full bo timeframe
   - `single`: loc chart theo timeframe da config

2. **Capture path**
   - `captureAllCharts()` hoac helper lien quan phai co cach nhan danh sach chart runtime, khong hardcode full `CHARTS`

3. **Analyze path**
   - `analyzeAllCharts(...)` van co the dung lai, nhung input screenshots trong `single` chi gom 1 timeframe/pair
   - metadata/summary/setup phai khong gay hieu nham la da xet du D1/H4/M15 neu thuc te chi xet `M15`

4. **Logging**
   - `src/charts/index.ts` can log ro:
     - timeframe mode
     - primary timeframe
     - danh sach intervals thuc te dang chay

5. **Cache analysis key**
   - key phai bao gom:
     - candle close key
     - engine mode
     - timeframe mode
     - primary timeframe (neu single)
   - tranh dung chung cache giua:
     - `multi`
     - `single:M15`
     - `single:H4`

6. **Telegram/result**
   - van gui ket qua nhu cu
   - nhung text/log can phan anh dung mode hien tai

## Khong lam

- Khong doi logic deterministic pattern detection neu khong can
- Khong doi threshold setup
- Khong cai lai kien truc lon hon muc can thiet

## Verification

Bat buoc:

```bash
npm run test -- --run
npm run build
```

Thu cong:

```bash
$env:CHART_TIMEFRAME_MODE='single'
$env:CHART_PRIMARY_TIMEFRAME='M15'
$env:CHART_ENGINE_MODE='deterministic'
npm run analyze
```

Ky vong:

- log cho thay single-timeframe mode
- chi chay `M15`
- khong con capture/analyze `D1`/`H4`

Ghi ket qua vao `result.md`.
