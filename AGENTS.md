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
│   │   ├── task.md               # [Lead] Specific executable task for one worker profile session
│   │   ├── result.md             # [Worker] Execution results
│   │   └── blocked.md            # [Worker] Blocked — needs clarification
│   └── 02-<subtask-id>/
│       ├── task.md
│       ├── result.md
│       └── blocked.md
```

## Protocol

### Roles

| Role | Provider | Model | Effort | Behavior |
|------|----------|-------|--------|----------|
| **Lead** | OpenRouter (or `anthropic`/`openai-codex`) | `anthropic/claude-sonnet-5` (or `gpt-5.5`) | medium/high | Plans, breaks work into worker-ready subtasks, reviews, coordinates via files. Does not auto-spawn subagents unless explicitly requested. |
| **Worker** | OpenRouter (or `openai-codex`) | `anthropic/claude-haiku-4.5` (or `gpt-5.4-mini`) | low | Executes assigned `tasks/<task-id>/<subtask-id>/task.md` exactly as specified. No deviations, no extras. Fast, cheap execution. |

### Workflow Steps

```
Lead                                      Worker profile sessions
  │                                         
  ├── Writes parent plan.md                 
  ├── Breaks plan into subtasks             
  ├── Creates 01-*/task.md, 02-*/task.md    
  ├── Marks parallelizable/dependencies     
  │                                         
  │                                    ┌──── worker A reads 01-*/task.md
  │                                    │     executes precisely
  │                                    ├──── writes 01-*/result.md
  │                                    │
  │                                    ┌──── worker B reads 02-*/task.md
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

## Launch Commands

```bash
# Launch as Lead (planner/reviewer)
hermes --profile lead

# Launch as Worker (executor)
hermes --profile worker
```

## Rules for Both Agents

1. **Lead: every plan must include a `## Subtasks` table and one `task.md` per worker subtask**, unless the user explicitly requests a single-task plan
2. **Never modify files outside the task directory** unless the task explicitly says so
3. **Worker: never modify parent `done.md`** — only the Lead writes final approval
4. **Always read the full task before starting**
5. **Worker: if unsure, write blocked.md — never guess**
6. **Lead: always review code against plan.md and each subtask task.md — not just "does it run" but "does it match the architecture"**
7. **Commit messages: Lead decides when and what to commit**