# Task 05: Thêm 3 job Volman (M15/H1/H4) vào Windows Task Scheduler hạ tầng có sẵn

**Prerequisite**: Task 04 (cần wiring `CHART_PRIMARY_TIMEFRAME` hoạt động).

**Objective**: 
1. Dùng hạ tầng Windows Task Scheduler có sẵn tại `deploy/windows/` (KHÔNG tạo file `.bat` riêng).
2. Tạo 3 scheduled tasks độc lập: M15, H1, H4 chạy song song.
3. Update `README.md` hướng dẫn cách setup.

## Background
- Hiện tại: `deploy/windows/` có `register-tasks.ps1` + `run-job.ps1` (PowerShell scripts).
- Tái dùng hạ tầng này thay vì tạo file `.bat` mới.

## Files to Modify

### 1. `deploy/windows/run-job.ps1`

Update PowerShell script để accept timeframe param:

```powershell
# run-job.ps1

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('M15', 'H1', 'H4')]
    [string]$Timeframe
)

# Set env variable for npm run analyze
$env:CHART_PRIMARY_TIMEFRAME = $Timeframe

# Log job start
Write-Host "[$(Get-Date)] Starting Volman analysis for $Timeframe timeframe"

# Run npm analyze
cd "C:\path\to\auto-signal-bot"  # Update with actual repo path
npm run analyze

# Check exit code
if ($LASTEXITCODE -ne 0) {
    Write-Host "[$(Get-Date)] ERROR: Volman $Timeframe analysis failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "[$(Get-Date)] Volman $Timeframe analysis completed successfully"
```

### 2. `deploy/windows/register-tasks.ps1`

Create 3 scheduled tasks (M15, H1, H4):

```powershell
# register-tasks.ps1

# Admin check
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: This script must run as Administrator"
    exit 1
}

$repoPath = "C:\path\to\auto-signal-bot"  # Update with actual repo path
$scriptPath = "$repoPath\deploy\windows\run-job.ps1"

# Timeframes to schedule
$timeframes = @('M15', 'H1', 'H4')

# Schedule times (example: M15 every 15 min, H1 every 60 min, H4 every 4 hours)
$schedules = @{
    'M15' = @{ Interval = 15; TimeUnit = 'Minute' }
    'H1'  = @{ Interval = 60; TimeUnit = 'Minute' }
    'H4'  = @{ Interval = 240; TimeUnit = 'Minute' }
}

foreach ($timeframe in $timeframes) {
    $taskName = "Volman-Analyze-$timeframe"
    $schedule = $schedules[$timeframe]
    
    # Check if task already exists
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    
    if ($existingTask) {
        Write-Host "Task $taskName already exists. Unregistering..."
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    
    # Register new task
    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Timeframe $timeframe"
    
    $trigger = New-ScheduledTaskTrigger `
        -RepetitionInterval (New-TimeSpan -$($schedule.TimeUnit) $schedule.Interval) `
        -At (Get-Date)
    
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RunOnlyIfNetworkAvailable
    
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Volman $timeframe analysis — independent scheduled task" | Out-Null
    
    Write-Host "✓ Task created: $taskName (runs every $($schedule.Interval) $($schedule.TimeUnit)s)"
}

Write-Host "`nAll Volman tasks registered. Run 'schtasks /query' to verify."
```

### 3. Update `deploy/windows/README.md`

```markdown
# Windows Task Scheduler Setup for Volman Multi-Timeframe

## Overview
Run 3 independent Volman analysis jobs (M15, H1, H4) on Windows Task Scheduler.
Each job processes only its own timeframe's signals and positions.

## Prerequisites
- Windows 10/11 (or Windows Server with Task Scheduler).
- Node.js + npm installed and in PATH.
- Git repo cloned at: `C:\path\to\auto-signal-bot` (or update in script).
- **PowerShell 5.0+** (built-in on Windows 10+).

## Installation

### 1. Run Registration Script (As Administrator)
```powershell
# Open PowerShell as Administrator
cd C:\path\to\auto-signal-bot\deploy\windows

# Execute registration script
.\register-tasks.ps1
```

This creates 3 scheduled tasks:
- **Volman-Analyze-M15**: Runs every 15 minutes.
- **Volman-Analyze-H1**: Runs every 60 minutes.
- **Volman-Analyze-H4**: Runs every 240 minutes (4 hours).

### 2. Verify Tasks Created
```powershell
schtasks /query | findstr "Volman"
```

Or via GUI:
- Open **Task Scheduler** (Win + R → `taskschd.msc`).
- Navigate to **Task Scheduler Library** → find `Volman-Analyze-*` tasks.

## Manual Run (Testing)
```powershell
# Test M15 job
C:\path\to\auto-signal-bot\deploy\windows\run-job.ps1 -Timeframe M15

# Test H1 job
C:\path\to\auto-signal-bot\deploy\windows\run-job.ps1 -Timeframe H1

# Test H4 job
C:\path\to\auto-signal-bot\deploy\windows\run-job.ps1 -Timeframe H4
```

## Logs
Task output redirects to Windows Event Viewer:
- **Event Viewer** → **Windows Logs** → **Application**.
- Filter by Source: `PowerShell` to find job logs.

Alternatively, add log file output to `run-job.ps1`:
```powershell
$logPath = "C:\path\to\auto-signal-bot\logs\volman-$Timeframe.log"
. run-job.ps1 -Timeframe M15 *>> $logPath
```

## Troubleshooting

### Task Runs but npm Fails
- Check Node.js PATH: `node -v` in PowerShell.
- Ensure `.env` file exists and has correct API keys.
- Verify `CHART_PRIMARY_TIMEFRAME` is properly set (script sets it automatically).

### Task Does Not Run at Scheduled Time
- Task Scheduler settings may need adjustment:
  - **Condition**: Uncheck "Stop if on batteries" (if on laptop).
  - **Condition**: Check "Run if network available".
  - **General**: Ensure user account has execute permission.

### Permission Denied
- Run PowerShell as Administrator.
- Set execution policy: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`.

## Disabling/Stopping Tasks

### Disable (keep task, don't run)
```powershell
Disable-ScheduledTask -TaskName "Volman-Analyze-M15"
```

### Enable (resume running)
```powershell
Enable-ScheduledTask -TaskName "Volman-Analyze-M15"
```

### Delete Task
```powershell
Unregister-ScheduledTask -TaskName "Volman-Analyze-M15" -Confirm:$false
```

## Adjusting Schedule
Edit triggers in Task Scheduler GUI:
1. Right-click task → **Properties**.
2. **Triggers** tab → select trigger → **Edit**.
3. Change interval (e.g., M15 from "15 minutes" to "10 minutes").

Or via PowerShell:
```powershell
# TODO: PowerShell command to modify trigger
```

## Notes
- Each job is **completely independent** — they run in separate processes.
- Timeframe data is isolated by `primary_timeframe` DB column.
- If one job fails, others continue (no cascade).
- **One-way mode**: Even if 2 timeframes send signals on same symbol, Binance One-way only allows 1 position per symbol.
```

## Validation

### 1. PowerShell Script Syntax
- Run `powershell -File "register-tasks.ps1" -Verbose` (test mode).
- Check for syntax errors.

### 2. Task Creation
```powershell
schtasks /query | findstr "Volman"
# Should output 3 tasks: Volman-Analyze-M15, Volman-Analyze-H1, Volman-Analyze-H4
```

### 3. Manual Run Test
```powershell
# Test each job manually
.\run-job.ps1 -Timeframe M15
# Should see log output, no errors
```

### 4. Scheduled Run Verification
- Wait for scheduled time (or manually trigger task in GUI).
- Check Windows Event Viewer for job output.
- Verify DB updated with position data matching timeframe.

## Important Notes

- **Repo path in scripts**: Update `$repoPath` in both `register-tasks.ps1` and `run-job.ps1` to match actual installation path.
- **Node.js PATH**: Ensure `npm` is in system PATH (check: `where npm` in PowerShell).
- **Execution policy**: May need `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` if PowerShell blocks script execution.
- **User account**: Task runs under logged-in user account — ensure user has read/write access to repo + DB credentials in `.env`.

## Acceptance Criteria
- ✅ `register-tasks.ps1` creates 3 scheduled tasks without errors.
- ✅ `run-job.ps1` accepts `-Timeframe` parameter (M15/H1/H4).
- ✅ Manual run: `.\run-job.ps1 -Timeframe M15` succeeds (no errors).
- ✅ Scheduled tasks visible in Task Scheduler GUI.
- ✅ README.md updated with setup instructions + troubleshooting.

## Result File
Ghi result tại `tasks/separate-timeframe-scheduling/05-add-task-scheduler-jobs/result.md` với:
- Files modified: `run-job.ps1`, `register-tasks.ps1`, `README.md` (line changes).
- Task creation output: `schtasks /query` result showing 3 tasks.
- Manual run test: `.\run-job.ps1 -Timeframe M15` output.
- README verification: sections added/updated.

## Notes for Next Phase
- After task 05 complete, user can manually trigger tasks via Task Scheduler GUI for testing.
- First production run should be monitored (check logs, DB updates, Telegram messages).
- If tasks fail, troubleshoot via Windows Event Viewer logs.
