#requires -Version 7.0
<#
.SYNOPSIS
  并行启动桌面开发栈：dotnet (5000) + frontend Vite (5174) + Tauri shell。

.DESCRIPTION
  - Tauri shell 在 dev (debug) 模式下会检测 5000 端口是否已有健康的后端，若有则复用。
  - 三个进程都用 cmd /c 包装，避免 Start-Process 直接调用 npm.cmd 等批处理脚本时报
    "%1 不是有效的 Win32 应用程序"。
  - Ctrl+C 时杀掉整棵进程树。
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

function Start-DevProcess {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Command
    )
    $proc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', $Command `
        -WorkingDirectory $WorkingDirectory `
        -PassThru -NoNewWindow
    Write-Host "[$Label] PID $($proc.Id)  cwd=$WorkingDirectory"
    return $proc
}

$backend  = Start-DevProcess -Label 'backend'  -WorkingDirectory $repoRoot `
              -Command 'dotnet run --project src/Hetu.Api --urls http://localhost:5000'

$frontend = Start-DevProcess -Label 'frontend' -WorkingDirectory (Join-Path $repoRoot 'frontend') `
              -Command 'npm run dev'

# 等一小会，避免 Tauri 启动时 Vite/后端尚未就绪导致首次加载白屏。
Start-Sleep -Seconds 3

$shell    = Start-DevProcess -Label 'shell'    -WorkingDirectory (Join-Path $repoRoot 'shell/hetu-desktop') `
              -Command 'npm run tauri:dev'

Write-Host ''
Write-Host 'Press Ctrl+C to stop all.' -ForegroundColor Yellow

try {
    Wait-Process -Id $backend.Id, $frontend.Id, $shell.Id
} finally {
    foreach ($p in @($backend, $frontend, $shell)) {
        if ($p -and -not $p.HasExited) {
            # 杀掉整棵进程树（cmd.exe + 子进程）
            cmd /c "taskkill /PID $($p.Id) /T /F" 2>$null | Out-Null
        }
    }
}
