# Task 07 - Final review AI surface sau khi chuyen algorithm-only

## Muc tieu

Lead review lai de dam bao trading va lottery khong con AI call path, docs khop voi runtime, va khong co regression lon.

## File can review

- Tat ca file da sua tu task 02-06
- `tasks/remove-ai-system-wide/*/result.md`
- `reviews/remove-ai-system-wide/review-summary.md` neu co

## Checklist review

1. Trading
   - `npm run analyze` khong goi AI
   - no `ai`/`shadow` production branch
   - open/pending management khong fallback AI

2. Lottery
   - `npm run lottery-predict` khong goi AI
   - ensemble khong import AI predictor
   - cache method version khong reuse AI-era predictions sai cach

3. Shared/docs
   - Telegram wording khop algorithm-only
   - env/workflow khong yeu cau AI secrets cho trading/lottery
   - tests khong mock AI cho trading/lottery

4. Scope note
   - Neu betting van con AI, ghi ro trong review va tao follow-up task neu user muon bo AI tuyet doi toan repo

## Verification

```bash
npm run test -- --run
npm run build
rg -n "callOpenRouter|OpenRouter|Gemini|Claude|AI_VISION_MODEL|AI_TEXT_MODEL|lottery-ai-predict|từ AI|gọi AI|goi AI" src tests .env.example README.md docs .github
```

## Dau ra

- Neu OK: Lead viet `tasks/remove-ai-system-wide/done.md`
- Neu co issue: Lead viet `reviews/remove-ai-system-wide/review-summary.md`
