# Plan - Bo AI khoi trading va lottery, chuyen sang thuat toan thuan

## Context

He thong hien tai co nhieu diem dung AI/OpenRouter:

- Trading chart scan:
  - `src/charts/index.ts` van support `ai` va `shadow`
  - `src/charts/analyzer.ts` goi OpenRouter vision de phan tich chart
  - `src/charts/deterministic-pipeline.ts` da co numeric engine thay the cho setup Volman
- Trading position management:
  - `src/charts/position-decision.ts` goi OpenRouter vision de review vi the dang mo
  - `src/charts/check-open-trades-runner.ts` co rule theo gia, nhung fallback sang AI khi rule khong ket luan
  - `src/charts/check-pending-orders-runner.ts` co rule theo gia, nhung fallback sang AI de review pending order
- Lottery prediction:
  - `src/lottery/lottery-ai-predict.ts` goi OpenRouter text
  - `src/lottery/lottery-ensemble-predict.ts` dang weight AI 40%, stats 30%, regression 30%
  - `src/lottery/lottery-predict-runner.ts` va resync/log/message van goi/nhac AI
- Shared/ops:
  - `.env.example`, README, docs, tests, stats command, AI usage observability van con AI wording/config

Nguoi dung muon bo cac phan AI tren he thong va dung thuat toan cho 2 chuc nang:

1. Trading analysis/management
2. Lottery analysis/prediction

## Muc tieu

Sau khi hoan tat:

- Production trading khong goi OpenRouter/Gemini/Claude/AI model
- Production lottery prediction khong goi OpenRouter/Gemini/Claude/AI model
- Runtime mac dinh la algorithm-only
- Telegram message khong con noi ket qua "tu AI"
- Env/workflow/docs khong yeu cau API key AI cho trading/lottery
- Test suite khong con phu thuoc mock AI cho trading/lottery

## Nguyen tac thiet ke

1. **Trading scan**
   - Dung deterministic numeric engine lam duong chinh.
   - Xoa hoac cach ly `ai`/`shadow` engine mode khoi production runtime.
   - Neu sau nay can SMC thi dung strategy algorithm rieng, khong quay lai AI vision.

2. **Trading open/pending management**
   - Gia/OHLC la nguon quyet dinh chinh.
   - Khi khong du du lieu de ket luan:
     - open position: mac dinh `HOLD` voi comment ro ly do thieu du lieu
     - pending order: giu `PENDING` cho toi khi cham entry/SL/expiry, hoac cancel theo rule da dinh nghia
   - Khong chup chart chi de dua vao AI.

3. **Lottery prediction**
   - Bo `lottery-ai-predict` khoi ensemble production.
   - Ensemble algorithm-only nen gom:
     - stats frequency/gap/overdue
     - regression trend
     - co the them Markov/recency/cycle score neu can nang chat luong
   - Cache prediction van giu, nhung `method_version` phai doi de phan biet voi du lieu cu co AI.

4. **Shared cleanup**
   - AI usage dashboard/stats chi giu neu con module ngoai scope dung AI. Neu muc tieu la no-AI toan repo thi chuyen thanh hidden/deprecated hoac remove.
   - Documentation phai noi ro trading/lottery la algorithm-only.

## Scope can chu y

Repo co betting flow cung dang co AI/OpenRouter. Yeu cau lan nay tap trung vao trading va lottery. Neu muc tieu "khong con AI o bat ky dau trong repo", can them task rieng de thay betting AI bang algorithm/cache/raw-odds rules.

## Subtasks

| ID | Subtask | Muc tieu |
| --- | --- | --- |
| 01 | `01-audit-and-freeze-ai-surfaces/` | Lap inventory AI moi nhat cho trading + lottery + shared, va chot pham vi giu/xoa |
| 02 | `02-make-trading-scan-deterministic-only/` | Chuyen chart scan production sang deterministic-only, bo `ai`/`shadow` runtime |
| 03 | `03-replace-trade-management-ai-with-rules/` | Thay AI review open/pending bang rule/OHLC policy ro rang |
| 04 | `04-make-lottery-ensemble-algorithm-only/` | Bo AI predictor khoi lottery ensemble, them/chuẩn hoa scoring thuat toan |
| 05 | `05-migrate-cache-methods-and-telegram-copy/` | Doi method_version/cache wording/Telegram de khong con AI wording |
| 06 | `06-clean-env-workflows-docs-and-tests/` | Don env/workflow/docs/tests/shared stats cho algorithm-only |
| 07 | `07-final-ai-surface-review/` | Review grep toan repo, dam bao trading/lottery khong con AI call path |

## Verification chung

```bash
npm run test -- --run
npm run build
rg -n "callOpenRouter|OpenRouter|AI_VISION_MODEL|AI_TEXT_MODEL|lottery-ai-predict|CHART_ENGINE_MODE=.*(ai|shadow)|từ AI|goi AI|gọi AI" src tests .env.example README.md docs
```

Ky vong:

- Trading va lottery production khong con import `../shared/openrouter.js`
- `npm run analyze` chay deterministic-only
- `npm run lottery-predict` dung algorithm-only ensemble
- Telegram chart/lottery messages khong con label AI
- Neu betting van con AI, grep phai chi ra ro la ngoai scope task nay hoac tao task follow-up rieng
