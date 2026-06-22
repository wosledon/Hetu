#requires -Version 7.0
<#
.SYNOPSIS
  发布 Hetu.Api 为 Tauri sidecar 可执行文件并复制相关静态资源。

.DESCRIPTION
  - Mode = SelfContained  → 单文件、自带 .NET 运行时（fat 渠道，默认）
  - Mode = FrameworkDependent → 瘦版，需用户安装 .NET 10 Runtime（slim 渠道）

  产物会按 Tauri sidecar 命名约定输出到 shell/hetu-desktop/src-tauri/binaries/，
  例如 Windows x64：Hetu.Api-x86_64-pc-windows-msvc.exe。

.PARAMETER Mode
  发布模式：SelfContained（默认）/ FrameworkDependent

.PARAMETER Rid
  目标 RID：win-x64（默认）/ win-arm64 / osx-x64 / osx-arm64 / linux-x64 / linux-arm64

.EXAMPLE
  ./scripts/publish-backend.ps1
  ./scripts/publish-backend.ps1 -Mode FrameworkDependent -Rid linux-x64
#>

[CmdletBinding()]
param(
    [ValidateSet('SelfContained', 'FrameworkDependent')]
    [string]$Mode = 'SelfContained',

    [ValidateSet('win-x64', 'win-arm64', 'osx-x64', 'osx-arm64', 'linux-x64', 'linux-arm64')]
    [string]$Rid = 'win-x64'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$apiProj  = Join-Path $repoRoot 'src/Hetu.Api/Hetu.Api.csproj'
$binariesDir = Join-Path $repoRoot 'shell/hetu-desktop/src-tauri/binaries'

# RID → Rust target triple 映射（Tauri sidecar 命名约定）
$tripleMap = @{
    'win-x64'    = 'x86_64-pc-windows-msvc'
    'win-arm64'  = 'aarch64-pc-windows-msvc'
    'osx-x64'    = 'x86_64-apple-darwin'
    'osx-arm64'  = 'aarch64-apple-darwin'
    'linux-x64'  = 'x86_64-unknown-linux-gnu'
    'linux-arm64'= 'aarch64-unknown-linux-gnu'
}
$triple = $tripleMap[$Rid]
$exeSuffix = if ($Rid -like 'win-*') { '.exe' } else { '' }

$selfContained = $Mode -eq 'SelfContained'
$publishDir = Join-Path $repoRoot ("artifacts/publish/$Mode-$Rid")
if (Test-Path $publishDir) {
    Remove-Item $publishDir -Recurse -Force
}

Write-Host "[publish-backend] Mode=$Mode  Rid=$Rid  Triple=$triple"
Write-Host "[publish-backend] Output: $publishDir"

$publishArgs = @(
    'publish', $apiProj,
    '-c', 'Release',
    '-r', $Rid,
    "--self-contained=$($selfContained.ToString().ToLower())",
    '-o', $publishDir,
    "/p:PublishSingleFile=$($selfContained.ToString().ToLower())"
)
if ($selfContained) {
    $publishArgs += '/p:IncludeNativeLibrariesForSelfExtract=true'
    $publishArgs += '/p:EnableCompressionInSingleFile=true'
}
& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish 失败 (exit $LASTEXITCODE)"
}

if (-not (Test-Path $binariesDir)) {
    New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null
}

# 复制并改名为 sidecar 命名
$sourceExe = Join-Path $publishDir ("Hetu.Api$exeSuffix")
if (-not (Test-Path $sourceExe)) {
    throw "找不到发布产物 $sourceExe"
}
$targetExe = Join-Path $binariesDir ("Hetu.Api-$triple$exeSuffix")
Copy-Item $sourceExe $targetExe -Force
Write-Host "[publish-backend] sidecar -> $targetExe"

# 复制静态/运行时资源
$wwwrootSrc = Join-Path $publishDir 'wwwroot'
if (Test-Path $wwwrootSrc) {
    $wwwrootDst = Join-Path $binariesDir 'wwwroot'
    if (Test-Path $wwwrootDst) { Remove-Item $wwwrootDst -Recurse -Force }
    Copy-Item $wwwrootSrc $wwwrootDst -Recurse -Force
    Write-Host "[publish-backend] wwwroot -> $wwwrootDst"
}

$sqliteVecSrc = Join-Path $publishDir 'sqlite-vec'
if (Test-Path $sqliteVecSrc) {
    $sqliteVecDst = Join-Path $binariesDir 'sqlite-vec'
    if (Test-Path $sqliteVecDst) { Remove-Item $sqliteVecDst -Recurse -Force }
    Copy-Item $sqliteVecSrc $sqliteVecDst -Recurse -Force
    Write-Host "[publish-backend] sqlite-vec -> $sqliteVecDst"
}

Write-Host "[publish-backend] Done. Next: cd shell/hetu-desktop ; npm run tauri build"
