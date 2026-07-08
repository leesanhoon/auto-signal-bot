# Task 06 - Don env, workflow, docs va tests sau khi bo AI

## Muc tieu

Sau khi trading/lottery algorithm-only, tai lieu va CI/runtime config khong con yeu cau AI key/model.

## File du kien can sua

- `.env.example`
- `.github/workflows/*.yml`
- `README.md`
- `docs/**/*.md`
- `package.json` neu co script AI-only
- `tests/shared/*ai*` neu no khong con duoc dung
- `src/shared/ai-*` neu quyet dinh remove/deprecate

## Yeu cau

1. Env
   - Xoa AI env khoi chart/lottery docs
   - Neu betting con AI va out-of-scope, tach section rieng de khong gay hieu nham

2. Workflows
   - Analyze/lottery workflows khong pass AI secrets neu khong can

3. Docs
   - README noi ro trading/lottery algorithm-only
   - Remove huong dan Gemini/Claude/OpenRouter cho 2 chuc nang nay

4. Tests
   - Xoa/sua tests mock OpenRouter cho trading/lottery
   - Giu tests AI shared chi khi con consumer hop le ngoai scope

## Verification

```bash
npm run test -- --run
npm run build
rg -n "OPENROUTER_API_KEY|AI_VISION_MODEL|AI_TEXT_MODEL|Gemini|Claude|OpenRouter|AI usage|AI hôm nay" .env.example .github README.md docs src tests
```
