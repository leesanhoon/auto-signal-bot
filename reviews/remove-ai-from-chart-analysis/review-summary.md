# Review Summary - remove-ai-from-chart-analysis

## Status

CHANGES_REQUIRED

## Findings

### 1. AI inventory chua day du, con sot shared AI helpers va chart AI test surface (MEDIUM)

Audit hien tai da liet ke dung cac call site AI chinh trong chart flow, nhung inventory van chua bao quat het cac dependency AI can duoc tinh vao scope remove-AI.

Cac diem con sot can them vao inventory / implementation plan:

- `src/shared/openrouter.ts`
  - helper goi OpenRouter truc tiep
- `src/shared/ai-model-fallback.ts`
  - helper fallback giua cac model AI
- `src/shared/ai-usage.ts`
  - helper record usage cho AI calls
- `src/charts/test-analyze.ts`
  - script chart AI-specific de test/thu nghiem `analyzeAllCharts(...)`

Ly do can dua vao inventory:

- day la cac dependency truc tiep ma chart system dang dung de goi model / ghi usage
- neu task remove-AI sau nay chi xoa call site trong `src/charts/*` ma khong chot so phan cac helper/script nay, repo van con chart-analysis AI surface chua duoc don sach

## Yeu cau fix

1. Cap nhat `result.md` de bo sung cac file/helper/script tren vao AI inventory.

2. Trong phan implementation order / can bo ngay, ghi ro:
   - helper nao se duoc bo khoi chart flow
   - helper nao co the con duoc giu lai neu dung cho module khac ngoai charts
   - `src/charts/test-analyze.ts` se bi xoa, doi ten, hay giu lai nhung khong con thuoc chart production flow

3. Neu worker thay con file nao khac mang tinh chart-AI specific, bo sung luon trong inventory de task sau khong bi thieu scope.

## Verification

Khong can build/test neu chi cap nhat audit.
Neu co sua code nho de lam ro contract thi ghi ro trong `result.md`.
