# Cleanup Completed Task Artifacts Implementation Plan

> **Goal:** Archive/delete ephemeral task artifacts from completed workstreams, keeping only project documentation and active task dirs.

**Architecture:** Simple rm -rf + verification. No code changes, no service impact.

**Scope:** Only tasks dirs with `done.md` and the stale `CODEX-TASK.md`.

---

## Inventory of cleanup candidates

| # | Path | Reason | Action |
|---|------|--------|--------|
| 1 | `tasks/fix-telegram-vietnamese-review/` | Has `done.md`, completed | `rm -rf` |
| 2 | `tasks/continue-single-pass-ai-analysis/` | Has `done.md`, completed | `rm -rf` |
| 3 | `CODEX-TASK.md` | Stale historical task, user said "nếu không cần đến" | Confirm then `rm` |
| 4 | `tasks/combined-match-analysis/` | Active (no `done.md`) | **Keep** |
| 5 | `tasks/fix-combined-followup/` | Active (no `done.md`) | **Keep** |

Other project/utility files (`docs/`, `plans/`, `README.md`, `AGENTS.md`, `tasks/README.md`, `hermes-backup/README.md`) — **Keep** as documented.

---

## Step-by-step

### Step 1: Confirm `CODEX-TASK.md` status

Check with user: does `CODEX-TASK.md` still serve a purpose? If no, include in cleanup.

### Step 2: Remove archived task dir

```bash
rm -rf "tasks/fix-telegram-vietnamese-review"
rm -rf "tasks/continue-single-pass-ai-analysis"
```

### Step 3: (Conditional) Remove CODEX-TASK.md

```bash
rm -f "CODEX-TASK.md"
```

### Step 4: Verify nothing else touched

```bash
git status --short
```

Expected output: only modified tracked files from active work (betting source + tests), plus remaining active task dirs. No untracked reference to deleted task dirs.

### Step 5: Verify project still builds and tests pass

```bash
cd H:/LeeSanHoon/auto-signal-bot
npx tsc --noEmit
npm test -- tests/betting/odds-runner.test.ts tests/betting/odds-text-format.test.ts
```

---

## Files changed

- Delete: `tasks/fix-telegram-vietnamese-review/*`
- Delete: `tasks/continue-single-pass-ai-analysis/*`
- Delete: `CODEX-TASK.md` (conditional)

No tracked source files are touched. No git history is rewritten (plain rm + commit).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| User still references a task artifact | The content is in git history (`git log` or `git show HEAD~:path`), recoverable |
| Accidentally deleting active task | Only delete dirs with `done.md`; verify `git status` shows expected state |

---

## Tests / validation

- `git status` shows deletions only
- `npx tsc --noEmit` passes
- `npm test` passes (unrelated to deleted files)