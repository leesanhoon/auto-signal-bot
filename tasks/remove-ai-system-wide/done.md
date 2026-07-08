# Done - remove-ai-system-wide

## Final status

APPROVED

## What is complete

- Trading runtime chinh da chuyen sang deterministic-only.
- Trading open trade / pending order management da bo AI va dung rule theo OHLC.
- Lottery runtime chinh da chuyen sang algorithm-only ensemble.
- Telegram copy, cache/versioning, env/workflow/docs/tests da duoc cap nhat theo huong khong con AI cho trading/lottery.
- Legacy AI chart analyzer trong trading area (`src/charts/analyzer.ts`) da duoc cleanup thanh utility-only module, khong con OpenRouter / model fallback surface.
- Review follow-up cho:
  - missing chart config alerting
  - stats dashboard wording
  - missing chart config decision semantics
  da duoc xu ly va approve.

## Scope note

Task nay hoan tat cho scope trading + lottery runtime va trading-area legacy analyzer cleanup.

Ngoai scope va van con AI:

- betting flow
- shared AI helpers phuc vu khu vuc ngoai trading/lottery

Neu can remove AI toan repo, can mo task rieng cho betting va shared helper cleanup.
