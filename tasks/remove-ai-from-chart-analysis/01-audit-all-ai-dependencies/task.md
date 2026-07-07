# Task 01 - Audit toan bo AI dependencies trong chart system

## Muc tieu

Ra soat day du moi diem ma chart system hien tai con dung AI, de lam co so cho cac task bo AI o cac buoc sau.

Task nay la audit + chia scope chinh xac.
Khong can refactor lon trong task nay, tru khi can sua nho de lam ro contract.

## Pham vi phai audit

### 1. Chart scan engine

Ra soat cac file sau va bat ky file lien quan:

- `src/charts/index.ts`
- `src/charts/analyzer.ts`
- `src/charts/screenshot.ts`
- `src/charts/deterministic-pipeline.ts`
- `src/charts/chart-config-env.ts`

Can tra loi ro:

- AI duoc dung o dau
- deterministic duoc dung o dau
- `CHART_ENGINE_MODE` con cho phep nhung mode nao
- screenshot co con can neu production chi dung deterministic hay khong

### 2. Trade / position management

Ra soat:

- `src/charts/check-open-trades-runner.ts`
- `src/charts/check-pending-orders-runner.ts`
- `src/charts/position-decision.ts`
- bat ky helper nao lien quan

Can tra loi ro:

- open trade review co con AI hay khong
- pending order review co con AI hay khong
- neu bo AI thi can thay the bang rule-based logic nao, hay tam thoi disable behavior nao

### 3. Telegram / orchestration coupling

Ra soat:

- `src/shared/telegram.ts`
- `src/charts/index.ts`

Can phan biet:

- phan nao la AI-specific
- phan nao chi la delivery/notify, co the giu lai du khong dung AI

### 4. Workflow / env / docs

Ra soat:

- `.github/workflows/analyze.yml`
- `.env.example`
- script trong `package.json`
- bat ky docs/task/comment nao van imply analyze production con dung AI

## Deliverable bat buoc

Ghi `result.md` voi 4 phan ro rang:

1. **AI inventory**
   - liet ke tung file/chuc nang con dung AI

2. **Can bo ngay**
   - nhung dependency AI phai remove de dat muc tieu "algorithm only"

3. **Can thay the bang rule**
   - nhung cho khong the chi xoa ma can luat thay the

4. **Implementation order de xuat**
   - de xuat thu tu sua cho cac task sau

## Dinh nghia "AI dependency" trong task nay

Tinh la AI dependency neu co mot trong cac dau hieu sau:

- goi model vision/text
- nhan quyet dinh trading tu model
- co mode runtime `ai`/`shadow`
- workflow/env production con feed AI model cho chart flow

Khong tinh la AI dependency neu:

- chi la Telegram transport thuần
- chi la logging
- chi la deterministic rules / indicators / backtest

## Khong lam

- Khong refactor lon trong task audit nay
- Khong xoa file hang loat khi chua chot scope
- Khong sua behavior production mot cach am tham trong task audit

## Verification

Khong can build/test neu chi audit thuần.
Neu worker co sua nho de lam ro contract thi phai ghi ro va chay:

```bash
npm run build
npm run test -- --run
```
