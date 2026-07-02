# Task 03 — Markdown task/plan cleanup inventory

## Objective
Review all `.md` files in the repo and produce a cleanup plan. Do **not** delete files in this task.

## Files allowed
- Read-only inventory across `*.md`
- Write result only: `tasks/fix-combined-followup/03-md-cleanup-plan/result.md`

## Current markdown inventory categories
From repo scan, relevant markdown groups include:

### Project documentation — keep by default
- `README.md`
- `AGENTS.md`
- `CODEX-TASK.md` (confirm if still useful)
- `docs/**/*.md`
- `plans/**/*.md`
- `tasks/README.md`
- `hermes-backup/README.md`

### Task artifacts — candidates for deletion/archive after approval
- `tasks/combined-match-analysis/**.md`
- `tasks/fix-combined-followup/**.md`
- `tasks/continue-single-pass-ai-analysis/**.md`
- `tasks/fix-telegram-vietnamese-review/**.md`

## Required output
Write `result.md` with a table:

| Path/pattern | Category | Keep/Delete/Archive candidate | Reason | Safe deletion condition |
|--------------|----------|-------------------------------|--------|-------------------------|

## Policy
- Do not delete active task dirs until their `done.md` exists or user explicitly approves.
- Do not delete project docs under `docs/` or root docs unless the user explicitly confirms they are obsolete.
- Prefer deleting completed task artifact directories after final code is merged/approved:
  - `tasks/continue-single-pass-ai-analysis/` has `done.md` → likely safe candidate
  - `tasks/fix-telegram-vietnamese-review/` has `done.md` → likely safe candidate
  - `tasks/combined-match-analysis/` is active → keep until current follow-up review is complete
  - `tasks/fix-combined-followup/` is active → keep until complete

## Verification
No code commands required. Use file search/read only.

## Result file
`tasks/fix-combined-followup/03-md-cleanup-plan/result.md`
