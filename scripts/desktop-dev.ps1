#requires -Version 7.0
<#
.SYNOPSIS
  并行启动桌面开发栈：dotnet (5000) + frontend Vite (5174) + Tauri shell。

.DESCRIPTION
  - Tauri shell 在 dev (debug) 模式下会检测 5000 端口是否已有健康的后端，若有则复用。
  - 三个进程在同一终端启动，Ctrl+C 时一起回收。
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

$backend = Start-Process -FilePath 'dotnet' `
    -ArgumentList 'run', '--project', "$repoRoot/src/Hetu.Api", '--urls', 'http://localhost:5000' `
    -PassThru -NoNewWindow

$frontend = Start-Process -FilePath 'npm' `
    -ArgumentList 'run', 'dev' `
    -WorkingDirectory "$repoRoot/frontend" `
    -PassThru -NoNewWindow

# 等一小会，避免 Tauri 启动时 Vite/后端尚未就绪导致首次加载白屏。
Start-Sleep -Seconds 3

$shell = Start-Process -FilePath 'npm' `
    -ArgumentList 'run', 'tauri:dev' `
    -WorkingDirectory "$repoRoot/shell/hetu-desktop" `
    -PassThru -NoNewWindow

Write-Host "Backend PID:  $($backend.Id)"
Write-Host "Frontend PID: $($frontend.Id)"
Write-Host "Shell PID:    $($shell.Id)"
Write-Host "Press Ctrl+C to stop all."

try {
    Wait-Process -Id $backend.Id, $frontend.Id, $shell.Id
} finally {
    foreach ($id in @($backend.Id, $frontend.Id, $shell.Id)) {
        Stop-Process -Id $id -ErrorAction SilentlyContinue
    }
}
