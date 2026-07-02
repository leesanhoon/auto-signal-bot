# Multi-Agent Task Queue Protocol

This project uses a **file-based task queue** to coordinate between a Lead/Planner agent and Worker/Executor agents.

## Directory Structure

```
tasks/
├── <task-id>/              # kebab-case, e.g. "add-auth-middleware"
│   ├── plan.md             # [Lead] Detailed architecture plan
│   ├── task.md             # [Lead] Specific executable task for worker
│   ├── context.md          # [Lead] Optional background / references
│   ├── result.md           # [Worker] Execution results
│   ├── review.md           # [Lead] Review findings / issues to fix
│   ├── blocked.md          # [Worker] Blocked — needs clarification
│   └── done.md             # [Lead] Final approval
```

## Protocol

### Roles

| Role | Model | Behavior |
|------|-------|----------|
| **Lead** | Claude Sonnet (anthropic/claude-sonnet-4) | Plans, reviews, delegates via files. Uses `claude -p` for complex coding subtasks. |
| **Worker** | DeepSeek V4 Flash (deepseek/deepseek-v4-flash) | Executes tasks exactly as specified. No deviations. |

### Workflow Steps

```
Lead                                      Worker
  │                                          
  ├── Writes plan.md                        
  ├── Writes task.md                        
  ├── Writes context.md (optional)          
  │                                          
  │                                    ┌──── read task.md + context.md
  │                                    │     execute precisely
  │                                    ├──── write result.md
  │                                    │
  ├── Reads result.md ◄────────────────┘
  ├── Reviews against plan.md
  ├── Writes review.md (APPROVED or ISSUES)
  │
  │                                    ┌──── read review.md
  │                                    │     if ISSUES → fix, update result.md
  │                                    ├──── if APPROVED → done (wait)
  │                                    │
  ├── Reads updated result.md ◄────────┘
  ├── If all issues resolved → write done.md
  └── Done!
```

### File Format Conventions

**plan.md:**
```markdown
# Plan: <Title>

## Architecture
- Key decisions & rationale
- Component breakdown

## Implementation
- File list with responsibilities
- Data flow
- Interfaces/signatures

## Testing Strategy

## Edge Cases & Error Handling
```

**task.md:**
```markdown
# Task: <Title>

## Objective
One-line summary of what to do.

## Instructions (numbered, precise)
1. Create/modify path/to/file.ext with exact content
2. Add function `fnName(params) -> returnType` that does X
3. ...

## Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2

## Files to Touch
- path/to/file1.ext — what to do
- path/to/file2.ext — what to do
```

**result.md:**
```markdown
# Result: <Title>

## Changes Made
- path/to/file1.ext: Created with function X
- path/to/file2.ext: Modified to add Y

## Verification
- Test output: ...
- Lint: ...

## Notes
(Any relevant observations, but no opinions)
```

**review.md:**
```markdown
# Review: <Title>

## Verdict: [APPROVED | CHANGES_REQUIRED]

## Issues (if CHANGES_REQUIRED)
1. [path/to/file:line] Description of issue
   - Expected: ...
   - Actual: ...
   - Fix: ...

## Overall Assessment
```

**blocked.md:**
```markdown
# Blocked: <Title>

## Blocking Issue
What is unclear or impossible.

## Missing Information
What I need from the Lead.

## Suggested Clarification (optional)
```

## Launch Commands

```bash
# Launch as Lead (planner/reviewer) — loads claude-code skill
lead -s claude-code

# Launch as Worker (executor)
worker

# Or with explicit profile flag:
hermes --profile lead -s claude-code
hermes --profile worker
```

## Rules for Both Agents

1. **Never modify files outside the task directory** unless the task explicitly says so
2. **Never modify tasks done.md** — only the Lead writes this
3. **Always read the full task before starting**
4. **Worker: if you're unsure, write blocked.md — never guess**
5. **Lead: always review code against plan.md — not just "does it run" but "does it match the architecture"**
6. **Commit messages: Lead decides when and what to commit**