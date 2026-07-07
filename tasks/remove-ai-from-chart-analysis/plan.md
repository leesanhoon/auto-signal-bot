# Plan - Remove all AI from chart analysis flow

## Context

User muon bo toan bo AI khoi he thong chart analysis va chi su dung thuat toan/rule-based logic.

Review code hien tai cho thay AI van con xuat hien o nhieu lop:

1. Scan engine chinh
   - `src/charts/index.ts`
   - `src/charts/analyzer.ts`
   - `src/charts/screenshot.ts`
   - `CHART_ENGINE_MODE` van cho phep `ai` va `shadow`

2. Position/pending management
   - `src/charts/check-pending-orders-runner.ts`
   - `src/charts/position-decision.ts`

3. Workflow / env / docs
   - `.github/workflows/analyze.yml`
   - `.env.example`
   - bat ky file nao van imply production analyze co the dung AI

Ngoai ra, `analyze` hien la mot orchestration job tron goi:
- phan tich
- cache
- save position/pending
- check open/pending
- gui Telegram

User hien chi yeu cau "bo tat ca phan tich tu AI" va dung "thuat toan khong dung AI".
Vi vay task nay can uu tien:

- loai bo AI khoi chart analysis va cac chart-management decisions co lien quan
- giu lai luong algorithmic/deterministic
- document ro nhung gi con giu va nhung gi bi loai

## Muc tieu

- Chart scanner production khong con su dung AI de phan tich chart.
- Pending/open-trade review trong chart flow khong con su dung AI.
- Workflow, env, docs, logs phan anh dung he thong moi: algorithmic only.

## Subtasks

| ID | Subtask | Muc tieu |
| --- | --- | --- |
| 01 | `01-audit-all-ai-dependencies/` | Liet ke day du moi diem AI con ton tai trong chart system va de xuat cach thay the/loai bo |
| 02 | `02-remove-ai-from-scan-runtime/` | Loai bo `ai`/`shadow` khoi chart scan runtime, giu deterministic la engine duy nhat |
| 03 | `03-remove-ai-from-trade-management/` | Bo AI khoi pending/open trade decision flow hoac thay bang rule-based logic |
| 04 | `04-clean-config-workflows-and-docs/` | Don dep env, workflow, docs, tests de phu hop architecture non-AI |

## Verification

```bash
npm run build
npm run test -- --run
```

Can ghi ro trong ket qua:

- file nao da duoc audit
- AI con ton tai o dau (neu co) va tai sao
- nhung behavior nao da doi sau khi bo AI
