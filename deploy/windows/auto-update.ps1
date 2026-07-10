# Tự động kiểm tra và pull code mới từ main, chạy bởi Task Scheduler mỗi đêm.
# Khác với update.ps1 (chạy tay, luôn force npm ci + playwright install):
# script này CHỈ npm ci / cài lại Chromium khi package-lock.json thực sự đổi,
# để giảm rủi ro va chạm với job khác đang chạy cùng lúc.
# Không throw ra ngoài (chạy unattended) — lỗi được ghi vào log để xem sau.

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("auto-update-{0:yyyy-MM-dd}.log" -f (Get-Date))

function Log([string]$msg) {
    Add-Content -Path $log -Value "[$(Get-Date -Format o)] $msg"
}

try {
    $before = (git rev-parse HEAD).Trim()
    git fetch origin main *>> $log
    if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }
    $remote = (git rev-parse origin/main).Trim()

    if ($before -eq $remote) {
        Log "Không có commit mới (HEAD=$before). Bỏ qua."
        exit 0
    }

    Log "Có commit mới: $before -> $remote"
    $lockChanged = git diff --name-only $before $remote -- package-lock.json

    git pull --ff-only origin main *>> $log
    if ($LASTEXITCODE -ne 0) { throw "git pull failed (có thể do merge conflict hoặc local changes)" }

    if ($lockChanged) {
        Log "package-lock.json thay đổi -> chạy npm ci + cài lại Chromium"
        npm ci *>> $log
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

        $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $repo ".playwright-browsers"
        npx playwright install chromium *>> $log
        if ($LASTEXITCODE -ne 0) { throw "playwright install failed" }
    }
    else {
        Log "package-lock.json không đổi -> bỏ qua npm ci"
    }

    Log "Cập nhật xong. Đang ở commit $remote"
}
catch {
    Log "LỖI: $_"
}

# Dọn log cũ hơn 30 ngày
Get-ChildItem $logDir -Filter "auto-update-*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
