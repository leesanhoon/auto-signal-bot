# Plan - Fix analyze CI timeframe/engine config wiring

## Context

Review runtime cho thay workflow CI `analyze` hien tai chua truyen day du env config cho chart scanner.

Cu the trong `.github/workflows/analyze.yml`, step `Run analysis` moi chi pass:

- `OPENROUTER_API_KEY`
- `AI_VISION_MODEL`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `CHART_SIGNAL_CONFIDENCE_THRESHOLD`
- `PENDING_ORDER_EXPIRY_RUNS`

Nhung chua pass:

- `CHART_ENGINE_MODE`
- `CHART_TIMEFRAME_MODE`
- `CHART_PRIMARY_TIMEFRAME`

He qua:

- GitHub Actions khong doc `.env` local
- scanner tren CI dang roi ve default cua code:
  - `CHART_ENGINE_MODE=shadow`
  - `CHART_TIMEFRAME_MODE=multi`
  - `CHART_PRIMARY_TIMEFRAME=M15`
- nen CI `analyze` hien tai khong nhat thiet chay theo config ma user dang ky vong

## Muc tieu

- Wire workflow `analyze` de nhan dung engine/timeframe config tu GitHub Actions environment vars.
- Giu behavior fallback cua code neu vars chua duoc set.
- Cap nhat tai lieu/env example neu can de phan biet ro local config va CI config.

## Subtasks

| ID | Subtask | Muc tieu |
| --- | --- | --- |
| 01 | `01-wire-analyze-workflow-env/` | Sua workflow `analyze.yml` va bo sung test/tai lieu can thiet de CI dung `CHART_ENGINE_MODE`, `CHART_TIMEFRAME_MODE`, `CHART_PRIMARY_TIMEFRAME` |

## Verification

```bash
npm run build
npm run test -- --run
```

Neu co the, mo ta them trong ket qua:

- workflow env nao da duoc them
- default runtime se la gi neu GitHub vars khong duoc set
