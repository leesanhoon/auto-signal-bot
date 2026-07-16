# Wrapper chạy 1 job của bot: nạp .env -> chạy npm script -> ghi log vào logs\.
# Được Task Scheduler gọi, hoặc chạy tay: .\run-job.ps1 -Job analyze
param(
    [Parameter(Mandatory = $true)][string]$Job
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

# Bảng job: npm script + env riêng + argument. Tên job khớp với register-tasks.ps1.
$jobs = @{
    "analyze"                     = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto" } }
    "analyze-volman-m15"          = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto"; CHART_PRIMARY_TIMEFRAME = "M15" } }
    "analyze-volman-h1"           = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto"; CHART_PRIMARY_TIMEFRAME = "H1" } }
    "analyze-volman-h4"           = @{ Script = "analyze"; Env = @{ CHART_RUN_CONTEXT = "auto"; CHART_PRIMARY_TIMEFRAME = "H4" } }
    "fetch-matches-list"          = @{ Script = "fetch-matches-list" }
    "match-odds"                  = @{ Script = "match-odds" }
    "performance-report-weekly"   = @{ Script = "performance-report"; Env = @{ PERFORMANCE_REPORT_PERIOD = "weekly" } }
    # Task Scheduler PS5.1 không tạo được trigger monthly -> trigger daily + guard ngày 1
    "performance-report-monthly"  = @{ Script = "performance-report"; Env = @{ PERFORMANCE_REPORT_PERIOD = "monthly" }; OnlyDayOfMonth = 1 }
    "lottery-predict"             = @{ Script = "lottery-predict" }
    "lottery-verify-mien-nam"     = @{ Script = "lottery-verify"; Args = "-- mien-nam" }
    "lottery-verify-mien-trung"   = @{ Script = "lottery-verify"; Args = "-- mien-trung" }
    "lottery-verify-mien-bac"     = @{ Script = "lottery-verify"; Args = "-- mien-bac" }
}

if (-not $jobs.ContainsKey($Job)) {
    throw "Unknown job '$Job'. Valid: $($jobs.Keys -join ', ')"
}
$def = $jobs[$Job]

if ($def.OnlyDayOfMonth -and (Get-Date).Day -ne $def.OnlyDayOfMonth) {
    exit 0
}

# Nạp .env vào process env
$envFile = Join-Path $repo ".env"
if (-not (Test-Path $envFile)) { throw ".env not found at $envFile" }
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line -split '=', 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
}

# Chromium nằm trong repo (xem update.ps1) để tài khoản SYSTEM cũng tìm thấy
if (-not [Environment]::GetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", "Process")) {
    [Environment]::SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", (Join-Path $repo ".playwright-browsers"), "Process")
}

# Env riêng của job (đè lên .env)
if ($def.Env) {
    foreach ($k in $def.Env.Keys) {
        [Environment]::SetEnvironmentVariable($k, $def.Env[$k], "Process")
    }
}

# Log theo ngày
$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("{0}-{1:yyyy-MM-dd}.log" -f $Job, (Get-Date))

$npmCmd = "npm run $($def.Script)"
if ($def.Args) { $npmCmd += " $($def.Args)" }

Add-Content -Path $log -Value "[$(Get-Date -Format o)] START $Job ($npmCmd)"
# Chạy qua cmd để gộp stdout+stderr vào log sạch sẽ (tránh NativeCommandError của PS5.1)
cmd /c "$npmCmd >> `"$log`" 2>&1"
$code = $LASTEXITCODE
Add-Content -Path $log -Value "[$(Get-Date -Format o)] END $Job exit=$code"

# Dọn log cũ hơn 30 ngày
Get-ChildItem $logDir -Filter "*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
