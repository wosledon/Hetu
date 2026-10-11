#!/usr/bin/env node
/**
 * 生成 Tauri updater 的更新清单（latest*.json）。
 *
 * 每个渠道（fat = Hetu / slim = Hetu (Slim)）各生成 4 份清单：
 *   1. latest[-slim].json          —— 资源直链走 GitHub
 *   2. latest[-slim]-mirror.json   —— 资源直链走第 1 个加速镜像（ghproxy.net）
 *   3. latest[-slim]-mirror2.json  —— 资源直链走第 2 个加速镜像（gh-proxy.com）
 *   4. latest[-slim]-mirror3.json  —— 资源直链走第 3 个加速镜像（ghfast.top）
 *
 * 应用侧 endpoints 顺序即「GitHub → 镜像1 → 镜像2 → 镜像3」：GitHub 不通时才会去取镜像清单，
 * 而镜像清单里的资源地址同样是镜像前缀，因此下载也能走通。
 *
 * 用法：
 *   node scripts/make-latest-json.mjs --dir dist --version 0.3.1 [--repo owner/repo] [--notes "…"] [--notes-file f]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const dir = resolve(args.get('dir') ?? 'dist')
const version = (args.get('version') ?? '').replace(/^v/, '')
const repo = args.get('repo') ?? 'wosledon/Hetu'
const proxies = [
  { suffix: '-mirror', prefix: 'https://ghproxy.net/' },
  { suffix: '-mirror2', prefix: 'https://gh-proxy.com/' },
  { suffix: '-mirror3', prefix: 'https://ghfast.top/' },
]

if (!version) {
  console.error('[latest.json] 缺少 --version')
  process.exit(1)
}

const notesFile = args.get('notes-file')
const notes = notesFile && existsSync(notesFile)
  ? readFileSync(notesFile, 'utf8').trim()
  : (args.get('notes') ?? `Hetu v${version}`)

/** 递归收集目录下的文件（artifact 解包后可能带 nsis/ msi/ appimage/ deb/ 等子目录） */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(dir)
const fileNames = files.map((f) => basename(f))
const tag = `v${version}`

/**
 * GitHub 资产名清洗规则：`Hetu (Slim)_0.3.2_x64-setup.exe` 上传后会变成
 * `Hetu.Slim._0.3.2_x64-setup.exe`（非法字符连续出现时只替换成一个点）。
 * 清单里的下载地址必须用清洗后的名字，否则 404。
 */
const toAssetName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, '.')

const releaseUrl = (asset) => `https://github.com/${repo}/releases/download/${tag}/${toAssetName(asset)}`

/**
 * 渠道判定：fat 的 productName 是 `Hetu`，slim 是 `Hetu (Slim)`
 * （见 src-tauri/tauri.slim.conf.json），资产名里一定带 Slim。
 */
const isSlim = (name) => /slim/i.test(name)

/** Windows 走 NSIS 安装包，Linux 走 AppImage；两者都要有同名 .sig */
function pickAsset(channel, kind) {
  const wantSlim = channel === 'slim'
  const wanted = fileNames.filter((f) => {
    if (isSlim(f) !== wantSlim) return false
    if (kind === 'windows') return f.endsWith('-setup.exe')
    return f.endsWith('.AppImage')
  })
  if (wanted.length === 0) return null
  const asset = wanted.sort()[0]
  const sigPath = files.find((f) => basename(f) === `${asset}.sig`)
  if (!sigPath) {
    console.warn(`[latest.json] ${channel}: 缺少 ${asset}.sig（构建时未提供签名私钥？）`)
    return null
  }
  return { asset, signature: readFileSync(sigPath, 'utf8').trim() }
}

function buildManifest(channel, urlFor) {
  const platforms = {}
  const windows = pickAsset(channel, 'windows')
  const linux = pickAsset(channel, 'linux')
  if (windows) platforms['windows-x86_64'] = { signature: windows.signature, url: urlFor(windows.asset) }
  if (linux) platforms['linux-x86_64'] = { signature: linux.signature, url: urlFor(linux.asset) }
  return { version, notes, pub_date: new Date().toISOString(), platforms }
}

function write(name, manifest) {
  if (Object.keys(manifest.platforms).length === 0) {
    missing.push(name)
    console.warn(`[latest.json] ${name}: 没有任何平台的签名产物，跳过`)
    return
  }
  const target = join(dir, name)
  writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`[latest.json] ${name}: ${Object.entries(manifest.platforms).map(([k, v]) => `${k}=${v.url.split('/').pop()}`).join(', ')}`)
}

const missing = []

for (const channel of ['fat', 'slim']) {
  const base = channel === 'fat' ? 'latest' : 'latest-slim'
  write(`${base}.json`, buildManifest(channel, releaseUrl))
  for (const proxy of proxies) {
    write(`${base}${proxy.suffix}.json`, buildManifest(channel, (asset) => proxy.prefix + releaseUrl(asset)))
  }
}

// 缺清单 = 该渠道的自动更新会 404（曾出现：slim 资产判定写错，slim 清单没生成）。
// 发布环节必须直接失败，而不是发一个更新点不动的版本。
if (missing.length > 0) {
  console.error(`[latest.json] 以下清单未生成：${missing.join(', ')}；请检查构建产物是否包含对应渠道的安装包与 .sig`)
  process.exit(1)
}
