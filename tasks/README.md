# Task Queue — Multi-Agent Coordination

This directory is the **file-based communication bus** between the Lead (planner/reviewer) and Worker (executor) agents.

## Quick Start

```bash
# 1. Lead: create a plan + task
lead -s claude-code
# Then: create tasks/your-task/plan.md and tasks/your-task/task.md

# 2. Worker: execute the task
worker
# Then: reads task.md, executes, writes result.md

# 3. Lead: review the work
lead -s claude-code
# Then: reads result.md, writes review.md (APPROVED or issues)

# 4. If issues → Worker fixes → goto 3
#    If approved → Lead writes done.md
```

## Status

- `plan.md` — Plan exists, ready for work
- `task.md` — Task assigned
- `result.md` — Worker completed
- `review.md` — Lead reviewed (check content for APPROVED or CHANGES_REQUIRED)
- `blocked.md` — Worker is stuck
- `done.md` — All complete ✅