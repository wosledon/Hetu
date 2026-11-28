#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 组件边界审计：统计页面/业务组件里的原生交互控件与包装层外的第三方组件 import。
 * 基线只降不升：scripts/ui-audit-baseline.json 记录当前允许的最大值，
 * 每个批次收敛后执行 `node scripts/audit-ui.mjs --update` 下调基线。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'frontend', 'src')
const BASELINE_PATH = join(ROOT, 'scripts', 'ui-audit-baseline.json')
const SCAN_DIRS = [join(SRC, 'pages'), join(SRC, 'components')]
const EXCLUDE_DIRS = [join(SRC, 'components', 'ui')]

/** 包装层：第三方库只允许在这些文件里出现 */
const WRAPPER_ALLOWLIST = [
  'components/ThemedMarkdown.tsx',
  'components/MilkdownEditor.tsx',
  'components/MermaidDiagram.tsx',
  'components/UsageHeatmap.tsx',
  'components/usage/',
  'components/work/WorkTerminal.tsx',
  'components/workflow/',
]

const THIRD_PARTY = [
  'echarts', 'echarts-for-react', 'echarts-for-react/esm/core',
  '@xyflow/react', 'milkdown', '@milkdown/', 'xterm', '@xterm/',
  'react-markdown', 'remark-', 'rehype-',
]

const CONTROL_RE = /<(button|input|textarea|select)\b/g
const IMPORT_RE = /from\s+'([^']+)'/g

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (EXCLUDE_DIRS.some((d) => full.startsWith(d))) continue
      walk(full, out)
    } else if (extname(full) === '.tsx') {
      out.push(full)
    }
  }
  return out
}

const isWrapper = (rel) => WRAPPER_ALLOWLIST.some((entry) => rel.startsWith(entry))
const isThirdParty = (mod) => THIRD_PARTY.some((pkg) => (pkg.endsWith('/') ? mod.startsWith(pkg) : mod === pkg || mod.startsWith(`${pkg}/`)))

const files = SCAN_DIRS.flatMap((dir) => walk(dir))
const controlHits = []
const thirdPartyHits = []
let controls = 0
let thirdParty = 0

for (const file of files) {
  const rel = relative(SRC, file).replaceAll('\\', '/')
  const code = readFileSync(file, 'utf8')
  const count = (code.match(CONTROL_RE) || []).length
  if (count > 0) {
    controls += count
    controlHits.push({ file: rel, count })
  }
  for (const match of code.matchAll(IMPORT_RE)) {
    if (isThirdParty(match[1]) && !isWrapper(rel)) {
      thirdParty += 1
      thirdPartyHits.push(`${rel}  ->  ${match[1]}`)
    }
  }
}

const current = { rawControls: controls, thirdPartyImports: thirdParty }
const update = process.argv.includes('--update')

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ ...current, updatedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`[audit-ui] 基线已更新: 原生控件 ${controls}，包装层外第三方 import ${thirdParty}`)
  process.exit(0)
}

let baseline
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
} catch {
  console.error('[audit-ui] 缺少基线文件，请先执行: node scripts/audit-ui.mjs --update')
  process.exit(1)
}

const failures = []
if (controls > baseline.rawControls) failures.push(`原生控件 ${controls} > 基线 ${baseline.rawControls}`)
if (thirdParty > baseline.thirdPartyImports) failures.push(`包装层外第三方 import ${thirdParty} > 基线 ${baseline.thirdPartyImports}`)

const top = controlHits.sort((a, b) => b.count - a.count).slice(0, 10)
console.log(`[audit-ui] 原生控件 ${controls}（基线 ${baseline.rawControls}），包装层外第三方 import ${thirdParty}（基线 ${baseline.thirdPartyImports}）`)
if (top.length > 0) {
  console.log('[audit-ui] 待收敛文件（Top 10）:')
  for (const { file, count } of top) console.log(`  ${String(count).padStart(3)}  ${file}`)
}
if (thirdPartyHits.length > 0 && process.argv.includes('--verbose')) {
  console.log('[audit-ui] 包装层外第三方 import:')
  for (const hit of thirdPartyHits) console.log(`  ${hit}`)
}

if (failures.length > 0) {
  console.error('[audit-ui] 失败：组件边界出现扩散')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('[audit-ui] 通过：组件边界未扩散')