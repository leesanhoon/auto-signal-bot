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

# analyze (Volman) — UTC 00:05,04:05,...,20:05 T2-T6
# = VN 07:05,11:05,15:05,19:05,23:05 (T2-T6) + 03:05 (T3-T7)
Register-BotTask "analyze" @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At "07:05"),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At "11:05"),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At "15:05"),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At "19:05"),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At "23:05"),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek @("Tuesday", "Wednesday", "Thursday", "Friday", "Saturday") -At "03:05")
)

# analyze-smc — mỗi 15 phút, T2-T6 theo UTC = VN từ T2 07:00 đến T7 06:45.
# Trigger T2-T6 lúc 07:00, lặp 15 phút trong ~24h (phủ đến 06:45 sáng hôm sau).
Register-BotTask "analyze-smc" @(
    (Add-Repetition (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At "07:00") 15 (New-TimeSpan -Hours 23 -Minutes 59))
)

# === Betting ===

# fetch-matches-list — 00:00 UTC = 07:00 VN hằng ngày
Register-BotTask "fetch-matches-list" @(
    (New-ScheduledTaskTrigger -Daily -At "07:00")
)

# match-odds — 05:00 UTC = 12:00 VN hằng ngày
Register-BotTask "match-odds" @(
    (New-ScheduledTaskTrigger -Daily -At "12:00")
)

# === Reports ===

# performance-report weekly — T2 01:15 UTC = T2 08:15 VN
Register-BotTask "performance-report-weekly" @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "08:15")
)

# performance-report monthly — ngày 1 lúc 01:20 UTC = 08:20 VN.
# PS5.1 không tạo được trigger monthly -> trigger daily, run-job.ps1 tự guard ngày 1.
Register-BotTask "performance-report-monthly" @(
    (New-ScheduledTaskTrigger -Daily -At "08:20")
)

# === Lottery ===

# lottery history scanner — 12:00 UTC = 19:00 VN hằng ngày
Register-BotTask "lottery" @(
    (New-ScheduledTaskTrigger -Daily -At "19:00")
)

# lottery-predict — 09:45/10:45/11:45 UTC = 16:45/17:45/18:45 VN
Register-BotTask "lottery-predict-mien-nam"   @((New-ScheduledTaskTrigger -Daily -At "16:45"))
Register-BotTask "lottery-predict-mien-trung" @((New-ScheduledTaskTrigger -Daily -At "17:45"))
Register-BotTask "lottery-predict-mien-bac"   @((New-ScheduledTaskTrigger -Daily -At "18:45"))

# lottery-verify — 09:45/10:45/11:50 UTC = 16:45/17:45/18:50 VN
Register-BotTask "lottery-verify-mien-nam"    @((New-ScheduledTaskTrigger -Daily -At "16:45"))
Register-BotTask "lottery-verify-mien-trung"  @((New-ScheduledTaskTrigger -Daily -At "17:45"))
Register-BotTask "lottery-verify-mien-bac"    @((New-ScheduledTaskTrigger -Daily -At "18:50"))

Write-Host ""
Write-Host "Xong. Kiểm tra: Get-ScheduledTask -TaskPath '$taskPath'"
Write-Host "Chạy thử ngay:  Start-ScheduledTask -TaskPath '$taskPath' -TaskName 'analyze-smc'"
