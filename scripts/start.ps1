$ROOT = Split-Path -Parent $PSScriptRoot

$backend = Start-Process -FilePath "dotnet" -ArgumentList "run", "--project", "$ROOT/src/Hetu.Api", "--urls", "http://localhost:5000" -PassThru -NoNewWindow
$frontend = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory "$ROOT/frontend" -PassThru -NoNewWindow

Write-Host "Backend PID: $($backend.Id)"
Write-Host "Frontend PID: $($frontend.Id)"
Write-Host "Press Ctrl+C to stop both"

try {
    Wait-Process -Id $backend.Id, $frontend.Id
} finally {
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $frontend.Id -ErrorAction SilentlyContinue
}
