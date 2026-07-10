# Gỡ toàn bộ scheduled task của bot. Chạy với quyền Administrator.
$ErrorActionPreference = "Stop"
Get-ScheduledTask -TaskPath "\AutoSignalBot\" -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false
Write-Host "Đã gỡ toàn bộ task trong \AutoSignalBot\"
