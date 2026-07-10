# Cập nhật code mới nhất trên mini PC.
# Chạy từ thư mục repo: .\deploy\windows\update.ps1
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

# Đồng bộ Chromium với version playwright trong lockfile.
# Cài vào thư mục trong repo để scheduled task (chạy dưới SYSTEM) tìm thấy.
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $repo ".playwright-browsers"
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "playwright install failed" }

Write-Host "Done. Code + dependencies đã cập nhật. Task Scheduler dùng bản mới ở lần chạy kế tiếp."
