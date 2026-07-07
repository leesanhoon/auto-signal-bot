# Task 01 - Wire analyze CI de dung engine/timeframe config

## Muc tieu

Sua workflow GitHub Actions `analyze` de scanner tren CI thuc su nhan dung config engine/timeframe thay vi roi ve default khong mong muon.

## Van de da xac nhan

Trong `.github/workflows/analyze.yml`, step `Run analysis` hien tai khong pass 3 env quan trong:

- `CHART_ENGINE_MODE`
- `CHART_TIMEFRAME_MODE`
- `CHART_PRIMARY_TIMEFRAME`

Vi GitHub Actions khong doc `.env` local, scanner tren CI dang fallback ve default cua code:

- `CHART_ENGINE_MODE=shadow`
- `CHART_TIMEFRAME_MODE=multi`
- `CHART_PRIMARY_TIMEFRAME=M15`

Dieu nay khien CI `analyze` co the khong chay dung theo timeframe/engine ma user da cau hinh tren GitHub environment.

## Yeu cau fix

1. Sua `.github/workflows/analyze.yml` de step `Run analysis` truyen them:

```yml
CHART_ENGINE_MODE: ${{ vars.CHART_ENGINE_MODE }}
CHART_TIMEFRAME_MODE: ${{ vars.CHART_TIMEFRAME_MODE }}
CHART_PRIMARY_TIMEFRAME: ${{ vars.CHART_PRIMARY_TIMEFRAME }}
```

2. Giu nguyen cac env hien co; chi bo sung cac env con thieu.

3. Khong hardcode gia tri timeframe/engine truc tiep vao workflow.
   - Workflow phai doc tu GitHub Actions `vars`
   - Neu `vars` chua set thi code runtime van fallback ve default nhu hien tai

4. Neu thay hop ly, cap nhat `.env.example` hoac ghi chu lien quan de user biet:
   - local `.env` va GitHub Actions `vars` la 2 kenh config khac nhau
   - de CI chay dung timeframe thi phai set vars tren environment GitHub

## Test / verification mong muon

Vi repo hien tai khong co test automation cho YAML workflow env mapping, worker khong can viet unit test gia cho workflow.
Thay vao do:

1. Dam bao build + test suite khong bi anh huong:

```bash
npm run build
npm run test -- --run
```

2. Trong `result.md`, ghi ro:
   - da them env nao vao workflow
   - scanner tren CI se doc timeframe/engine tu dau sau khi fix
   - fallback con lai la gi neu GitHub vars de trong / chua set

## Khong lam

- Khong doi logic runtime trong `src/charts/index.ts` neu khong can thiet
- Khong doi lich cron
- Khong doi secrets/vars khac ngoai pham vi workflow analyze
