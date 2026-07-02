# Multi-Agent Task Queue Protocol

This project uses a **file-based task queue** to coordinate between a Lead/Planner agent and Worker/Executor agents.

## Directory Structure

```
tasks/
├── <task-id>/                    # kebab-case parent task, e.g. "add-auth-middleware"
│   ├── plan.md                   # [Lead] Detailed architecture plan + subtask breakdown
│   ├── context.md                # [Lead] Optional shared background / references
│   ├── review.md                 # [Lead] Final review across all subtasks
│   ├── done.md                   # [Lead] Final approval
│   ├── 01-<subtask-id>/          # [Lead] Independently assignable subtask
│   │   ├── task.md               # [Lead] Specific executable task for one worker/subagent
│   │   ├── result.md             # [Worker/Subagent] Execution results
│   │   └── blocked.md            # [Worker/Subagent] Blocked — needs clarification
│   └── 02-<subtask-id>/
│       ├── task.md
│       ├── result.md
│       └── blocked.md
```

## Protocol

### Roles

| Role | Model | Behavior |
|------|-------|----------|
| **Lead** | GPT-5.5 via OpenAI Codex | Plans, breaks work into subtasks, reviews, delegates via files/subagents. |
| **Worker** | DeepSeek V4 Flash via OpenRouter (`deepseek/deepseek-v4-flash`) | Executes tasks exactly as specified. No deviations. |

### Workflow Steps

```
Lead                                      Workers/Subagents
  │                                          
  ├── Writes parent plan.md
  ├── Breaks plan into subtasks
  ├── Creates 01-*/task.md, 02-*/task.md
  ├── Marks parallelizable/dependencies
  │                                          
  │                                    ┌──── worker/subagent A reads 01-*/task.md
  │                                    │     executes precisely
  │                                    ├──── writes 01-*/result.md
  │                                    │
  │                                    ┌──── worker/subagent B reads 02-*/task.md
  │                                    │     executes precisely
  │                                    ├──── writes 02-*/result.md
  │                                    │
  ├── Reads all subtask result.md ◄────┘
  ├── Reviews against plan.md + task.md
  ├── Writes parent review.md (APPROVED or ISSUES)
  │
  │                                    ┌──── workers fix only listed issues
  │                                    ├──── update result.md
  │
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

## Subtasks

| ID | Owner | Parallelizable | Dependencies | Allowed files | Output |
|----|-------|----------------|--------------|---------------|--------|
| 01-<name> | worker/subagent | yes/no | none / 02-... | path/glob list | tasks/<task-id>/01-<name>/result.md |

For each subtask, Lead must create `tasks/<task-id>/<subtask-id>/task.md`. Avoid assigning two parallel subtasks to touch the same file.

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
# Launch as Lead (planner/reviewer)
lead

# Launch as Worker (executor)
worker

# Or with explicit profile flag:
hermes --profile lead
hermes --profile worker
```

## Rules for Both Agents

1. **Lead: every plan must include a `## Subtasks` table and one `task.md` per subtask**, unless the user explicitly requests a single-task plan
2. **Never modify files outside the task directory** unless the task explicitly says so
3. **Worker/Subagent: never modify parent `done.md`** — only the Lead writes final approval
4. **Always read the full task before starting**
5. **Worker/Subagent: if you're unsure, write blocked.md — never guess**
6. **Lead: always review code against plan.md and each subtask task.md — not just "does it run" but "does it match the architecture"**
7. **Commit messages: Lead decides when and what to commit**