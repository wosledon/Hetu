#requires -Version 7.0
<#
.SYNOPSIS
  创建并推送一个版本 tag，触发 release.yml CI 构建。

.DESCRIPTION
  读取 shell/hetu-desktop/src-tauri/tauri.conf.json 的 version，
  自动创建带 v 前缀的 tag 并 push 到 origin。

.EXAMPLE
  ./scripts/tag-release.ps1                # 用 tauri.conf.json 里的版本
  ./scripts/tag-release.ps1 -Version 0.2.0 # 指定版本
  ./scripts/tag-release.ps1 -Bump patch    # 自动 +1 (major/minor/patch)
#>

[CmdletBinding()]
param(
    [string]$Version,
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Bump,
    [string]$Remote = 'origin'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$confPath = Join-Path $repoRoot 'shell/hetu-desktop/src-tauri/tauri.conf.json'

# 当前版本（读 tauri.conf.json）
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$current = [version]$conf.version

# 目标版本
if ($Version) {
    $target = [version]$Version
} elseif ($Bump) {
    $target = switch ($Bump) {
        'major' { [version]::new($current.Major + 1, 0, 0) }
        'minor' { [version]::new($current.Major, $current.Minor + 1, 0) }
        'patch' { [version]::new($current.Major, $current.Minor, $current.Build + 1) }
    }
    # 回写 tauri.conf.json 的 version
    $raw = Get-Content $confPath -Raw
    $raw = $raw -replace '"version"\s*:\s*"[^"]+"', "`"version`": `"$target`""
    Set-Content $confPath $raw -NoNewline -Encoding utf8
    Write-Host "[tag] bump version: $current -> $target (已回写 tauri.conf.json)"
} else {
    $target = $current
}

$tag = "v$target"

# 防重复
$existing = git -C $repoRoot tag -l $tag
if ($existing) {
    throw "tag $tag 已存在。删除旧 tag: git tag -d $tag; git push $Remote :refs/tags/$tag"
}

if ($Bump) {
    git -C $repoRoot add $confPath
    git -C $repoRoot commit -m "chore(release): bump version to $target"
    Write-Host "[tag] committed version bump"
}

git -C $repoRoot tag $tag
git -C $repoRoot push $Remote $tag

Write-Host "[tag] pushed $tag -> $Remote，CI 已触发构建"
