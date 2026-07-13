# Đăng ký toàn bộ lịch chạy của bot vào Windows Task Scheduler.
# Chạy bằng PowerShell với quyền Administrator:
#   .\deploy\windows\register-tasks.ps1
#
# Toàn bộ giờ bên dưới là GIỜ VIỆT NAM (UTC+7), đã quy đổi từ lịch UTC
# của GitHub Actions. Máy phải đặt timezone UTC+7 (SE Asia Standard Time).

$ErrorActionPreference = "Stop"

$offset = (Get-TimeZone).BaseUtcOffset.TotalHours
if ($offset -ne 7) {
    Write-Warning "Timezone hiện tại là UTC+$offset, không phải UTC+7 (SE Asia Standard Time)."
    Write-Warning "Lịch bên dưới tính theo giờ VN. Đặt lại timezone trước:"
    Write-Warning "  Set-TimeZone -Id 'SE Asia Standard Time'"
    throw "Sai timezone — dừng để tránh chạy sai giờ."
}

$runJob = (Resolve-Path (Join-Path $PSScriptRoot "run-job.ps1")).Path
$taskPath = "\AutoSignalBot\"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

$weekdays = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")

# Gắn repetition (lặp mỗi X phút trong Y thời lượng) vào 1 trigger có sẵn
function Add-Repetition($trigger, [int]$intervalMinutes, $duration) {
    $rep = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes $intervalMinutes) `
        -RepetitionDuration $duration
    $trigger.Repetition = $rep.Repetition
    return $trigger
}

function Register-BotTask([string]$job, $triggers) {
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runJob`" -Job $job"
    Register-ScheduledTask `
        -TaskName $job `
        -TaskPath $taskPath `
        -Action $action `
        -Trigger $triggers `
        -Settings $settings `
        -Principal $principal `
        -Force | Out-Null
    Write-Host "Registered: $taskPath$job"
}

# === Charts ===

# analyze (Volman) — đóng cửa nến H4 mỗi ngày từ T2 đến CN.
# = VN 03:05,07:05,11:05,15:05,19:05,23:05
# Register-BotTask "analyze" @(
#     (New-ScheduledTaskTrigger -Daily -At "03:05"),
#     (New-ScheduledTaskTrigger -Daily -At "07:05"),
#     (New-ScheduledTaskTrigger -Daily -At "11:05"),
#     (New-ScheduledTaskTrigger -Daily -At "15:05"),
#     (New-ScheduledTaskTrigger -Daily -At "19:05"),
#     (New-ScheduledTaskTrigger -Daily -At "23:05")
# )

# Volman multi-timeframe independent tasks — mỗi timeframe chạy riêng
# M15: mỗi 15 phút
Register-BotTask "analyze-volman-m15" @(
    (Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 15 (New-TimeSpan -Days 1))
)

# H1: mỗi 60 phút (1 giờ)
Register-BotTask "analyze-volman-h1" @(
    (Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 60 (New-TimeSpan -Days 1))
)

# H4: mỗi 240 phút (4 giờ)
Register-BotTask "analyze-volman-h4" @(
    (Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 240 (New-TimeSpan -Days 1))
)

# === Betting ===

# fetch-matches-list — 00:00 UTC = 07:00 VN hằng ngày
Register-BotTask "fetch-matches-list" @(
    (New-ScheduledTaskTrigger -Daily -At "07:00")
)

# match-odds — 05:00 UTC = 20:00 VN hằng ngày
Register-BotTask "match-odds" @(
    (New-ScheduledTaskTrigger -Daily -At "20:00")
)

# === Reports ===

# performance-report weekly — T2 01:15 UTC = T2 08:15 VN
# Register-BotTask "performance-report-weekly" @(
#     (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "08:15")
# )

# performance-report monthly — ngày 1 lúc 01:20 UTC = 08:20 VN.
# PS5.1 không tạo được trigger monthly -> trigger daily, run-job.ps1 tự guard ngày 1.
# Register-BotTask "performance-report-monthly" @(
#     (New-ScheduledTaskTrigger -Daily -At "08:20")
# )

# === Lottery ===

# lottery history scanner — 12:00 UTC = 19:00 VN hằng ngày
Register-BotTask "lottery" @(
    (New-ScheduledTaskTrigger -Daily -At "18:50")
)

# lottery-predict — 09:45/10:45/11:45 UTC = 16:45/17:45/18:45 VN
Register-BotTask "lottery-predict-mien-nam"   @((New-ScheduledTaskTrigger -Daily -At "16:45"))
Register-BotTask "lottery-predict-mien-trung" @((New-ScheduledTaskTrigger -Daily -At "17:45"))
Register-BotTask "lottery-predict-mien-bac"   @((New-ScheduledTaskTrigger -Daily -At "18:45"))

# lottery-verify — 09:45/10:45/11:50 UTC = 16:45/17:45/18:50 VN
Register-BotTask "lottery-verify-mien-nam"    @((New-ScheduledTaskTrigger -Daily -At "16:45"))
Register-BotTask "lottery-verify-mien-trung"  @((New-ScheduledTaskTrigger -Daily -At "17:45"))
Register-BotTask "lottery-verify-mien-bac"    @((New-ScheduledTaskTrigger -Daily -At "18:50"))

# === Auto-update ===

# Tự pull code mới mỗi 15 phút.
# Chỉ git pull + (nếu package-lock.json đổi) npm ci — xem auto-update.ps1.
$autoUpdate = (Resolve-Path (Join-Path $PSScriptRoot "auto-update.ps1")).Path
$autoUpdateAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$autoUpdate`""
Register-ScheduledTask `
    -TaskName "auto-update" `
    -TaskPath $taskPath `
    -Action $autoUpdateAction `
    -Trigger (Add-Repetition (New-ScheduledTaskTrigger -Daily -At "00:00") 15 (New-TimeSpan -Days 1)) `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null
Write-Host "Registered: ${taskPath}auto-update"

Write-Host ""
Write-Host "Xong. Kiểm tra: Get-ScheduledTask -TaskPath '$taskPath'"
Write-Host "Chạy thử ngay:  Start-ScheduledTask -TaskPath '$taskPath' -TaskName 'analyze'"
