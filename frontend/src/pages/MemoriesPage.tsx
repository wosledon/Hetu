import { confirm } from '../components/confirm'
import { useState, useMemo, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Atom, Plus, Search, Trash2, Pencil, Save, Tag, Brain, X, Moon, Globe, FolderInput, MessagesSquare, Loader2, Sparkles, List, Crosshair, Activity, Pause } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import { memoryService } from '../services/memoryService'
import { projectService } from '../services/projectService'
import { settingService } from '../services/settingService'
import { useUIStore } from '../stores/uiStore'
import type { IMemory, MemoryScope } from '../types'

/** 作用域元数据：模拟记忆归属层级——全局公共 / 会话私有 / 项目内 */
const SCOPE_META: Record<MemoryScope, { label: string; icon: typeof Globe; badge: string }> = {
  Global: { label: '全局', icon: Globe, badge: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300' },
  Session: { label: '会话', icon: MessagesSquare, badge: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300' },
  Project: { label: '项目', icon: FolderInput, badge: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300' },
}

const CATEGORY_COLORS: Record<string, string> = {
  '偏好': 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  '身份': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  '工作': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  '习惯': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  '知识': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
}

function getCategoryColor(category?: string): string {
  if (!category) return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  return CATEGORY_COLORS[category] || 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 30) return `${diffDays} 天前`
  return date.toLocaleDateString('zh-CN')
}

const DAY_MS = 86400000

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 记忆强度（与后端检索评分同源，去掉语义相似度项后归一化）：
 * 0.3×重要性 + 0.2×近因衰减 + 0.1×频率强化，越接近 1 越牢固。
 */
function strengthOf(m: IMemory): number {
  const days = Math.max(0, (Date.now() - new Date(m.lastAccessedAt).getTime()) / DAY_MS)
  const recency = Math.exp(-0.05 * days)
  const freq = Math.log(1 + m.accessCount) / Math.log(51)
  return Math.min(1, Math.max(0.05, (0.3 * m.importance + 0.2 * recency + 0.1 * freq) / 0.6))
}

/** 生命周期状态（对齐后端 Dream 的衰减/遗忘阈值）：牢固 / 衰退中 / 濒临遗忘 */
function stateOf(m: IMemory, decayDays: number, forgetDays: number) {
  const days = Math.max(0, (Date.now() - new Date(m.lastAccessedAt).getTime()) / DAY_MS)
  if (days >= forgetDays) return { key: 'dying' as const, label: '濒临遗忘', dot: 'bg-red-500', chip: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' }
  if (days >= decayDays) return { key: 'fading' as const, label: '衰退中', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300' }
  return { key: 'fresh' as const, label: '牢固', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' }
}

/** 强度分段条：把「重要性 × 频率 × 近因」的合成值画成 5 段 */
function StrengthMeter({ memory }: { memory: IMemory }) {
  const value = strengthOf(memory)
  const filled = Math.max(1, Math.round(value * 5))
  return (
    <span className="flex items-center gap-1" title={`记忆强度 ${Math.round(value * 100)}%（重要性 × 频率 × 近因）`}>
      <span className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={`h-1.5 w-2.5 rounded-[2px] ${i < filled ? 'bg-teal-500/85' : 'bg-gray-200 dark:bg-white/10'}`} />
        ))}
      </span>
      <span className="tabular-nums">{Math.round(value * 100)}%</span>
    </span>
  )
}

/* ── 记忆星空：整页即夜空，三条作用域星域只是空间锚点，不再是画在纸上的圈 ──
   大小=重要性，亮度=强度（近因×频率×重要性），描边=生命周期状态，颜色=类别。
   按容器实际像素 1:1 布局（ResizeObserver），任何窗口比例都不裁剪、不拉伸。 */

/* 无限画布：世界坐标固定（单一星团以原点为中心），仅镜头（平移 + 缩放）变化 */

/** 监听容器尺寸：星空按真实像素排布，随窗口大小/比例即时重排；measured 表示已完成首次测量 */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 1000, h: 620 })
  const [measured, setMeasured] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: Math.max(320, el.clientWidth), h: Math.max(280, el.clientHeight) })
    update()
    setMeasured(true)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size, measured }
}

/** 布局整体变化（切作用域/筛选/数据更新）时，星点、核心与光晕共用同一条位移动画，避免分头行动 */
const SKY_POS_TRANSITION = 'cx .5s ease, cy .5s ease, r .5s ease'
/** 位移动画时长（ms），轨迹在此期间不画，防止尾巴与星点脱节 */
const SKY_POS_MS = 560

/** 赛博霓虹配色：深色用高亮霓虹，浅色用同色系深一档保证对比；描边=生命周期状态 */
interface SkyPalette {
  Global: string
  Session: string
  Project: string
  ringFresh: string
  ringFading: string
  ringDying: string
  /** 选中星的外环描边 */
  selRing: string
  trail: number
  halo: number
  bg: string
  border: string
  panel: string
  quiet: string
  label: string
  chipOn: string
  chipOff: string
  chipBox: string
  inputBox: string
}

const NEON: { dark: SkyPalette; light: SkyPalette } = {
  dark: {
    Global: '#22d3ee',
    Session: '#f472b6',
    Project: '#a78bfa',
    ringFresh: 'rgba(255,255,255,0.5)',
    ringFading: '#fbbf24',
    ringDying: '#f87171',
    selRing: 'rgba(255,255,255,0.85)',
    trail: 0.5,
    halo: 0.3,
    bg: '#070a14',
    border: 'border-white/10',
    panel: 'bg-[#0c1122]/95',
    quiet: 'text-slate-500',
    label: 'text-slate-300',
    chipOn: 'bg-white/15 text-slate-100',
    chipOff: 'text-slate-400 hover:text-slate-200',
    chipBox: 'bg-white/[0.07]',
    inputBox: 'border-white/10 bg-white/[0.05] text-slate-200 placeholder:text-slate-500',
  },
  light: {
    Global: '#0891b2',
    Session: '#db2777',
    Project: '#7c3aed',
    ringFresh: 'rgba(15,23,42,0.38)',
    ringFading: '#d97706',
    ringDying: '#dc2626',
    selRing: 'rgba(15,23,42,0.6)',
    trail: 0.32,
    halo: 0.16,
    bg: '#eef2ff',
    border: 'border-slate-200',
    panel: 'bg-white/95',
    quiet: 'text-slate-500',
    label: 'text-slate-700',
    chipOn: 'bg-white text-slate-800 shadow-sm',
    chipOff: 'text-slate-500 hover:text-slate-800',
    chipBox: 'bg-slate-900/[0.06]',
    inputBox: 'border-slate-200 bg-slate-900/[0.03] text-slate-700 placeholder:text-slate-400',
  },
}

/** 跟随应用主题（light / dark / system），星空在明暗两套配色间切换 */
function useIsDark(): boolean {
  const theme = useUIStore((s) => s.theme)
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(m.matches)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])
  return theme === 'dark' || (theme === 'system' && systemDark)
}

function ringFor(stateKey: 'fresh' | 'fading' | 'dying', pal: SkyPalette): string {
  if (stateKey === 'fading') return pal.ringFading
  if (stateKey === 'dying') return pal.ringDying
  return pal.ringFresh
}

/** 生命周期状态 → 描边色由调色板给出（ringFor），此处不再单列常量 */

/** 夜空底部筛选条的作用域按钮（选中态/待选态分别成串，避免灰字与彩色底同串出现） */
const SKY_SCOPE_ACTIVE = 'flex items-center gap-1.5 rounded-lg bg-teal-500/90 px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors'
const SKY_SCOPE_IDLE = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-900/[0.05] hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200'

interface SkyStar {
  memory: IMemory
  i: number
  x: number
  y: number
  r: number
  opacity: number
  fill: string
  /** 生命周期描边色（由调色板给出） */
  ring: string
  dashed: boolean
  dying: boolean
  /** 记忆强度（0–1）：驱动亮度、光晕、呼吸与核心高光 */
  strength: number
  /** 强记忆（≥0.72）叠加核心高光，像真正在发光 */
  core: boolean
  haloR: number
  haloO: number
  /** 呼吸深度：强浅弱深 */
  twk: number
  /** 运动性格：0 漫游（随机目标） / 1 轨道（缓绕原位） / 2 冲刺（蛰伏后快速掠到附近） */
  mode: 0 | 1 | 2
  speed: number
  radius: number
  interval: number
}

/** FNV-1a：把记忆 ID 变成稳定的种子，同一颗星的漂移/呼吸参数在每次渲染中都不变 */
function hashSeed(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 单一星团：所有记忆散在同一个有机星系里（中心密、外缘疏，强记忆更靠近核心），
    作用域只靠颜色区分；位置由记忆 ID 种子化，稳定但自然 */
const GALAXY_R = 600

function buildSkyStars(memories: IMemory[], decayDays: number, forgetDays: number, pal: SkyPalette): SkyStar[] {
  const list = [...memories].sort((a, b) => strengthOf(b) - strengthOf(a))
  const n = Math.max(1, list.length)
  return list.map((m, i) => {
    const state = stateOf(m, decayDays, forgetDays)
    const seed = hashSeed(m.id)
    const r1 = ((seed >>> 2) % 997) / 997
    const r2 = ((seed >>> 11) % 991) / 991
    const r3 = ((seed >>> 19) % 983) / 983
    // 径向按强度分层：越强越靠中心（列表已按强度降序），越弱越靠外；
    // 衰退中的 ×1.12、濒临遗忘的 ×1.28 直接推到外缘。
    // 抖动主要放在角度上，保持有机但不打乱「由内到外 = 由强到弱」的可读性
    const angle = i * 2.399963229728653 + (r1 - 0.5) * 1.6
    const stateBias = state.key === 'dying' ? 1.28 : state.key === 'fading' ? 1.12 : 0.98
    const radius = Math.max(66, GALAXY_R * Math.pow((i + 0.8) / n, 0.62) * stateBias * (0.9 + r2 * 0.2))
    const strength = strengthOf(m)
    const starR = (3 + m.importance * 7) * (0.85 + r3 * 0.3)
    return {
      memory: m,
      i,
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle) * 0.82,
      r: starR,
      // 强度可读性四件套：亮度区间拉大（弱星更暗）、光晕随强度变大变亮、
      // 强星叠加核心高光、呼吸强浅弱深（弱星闪得深——不稳定的直觉）
      opacity: 0.22 + strength * 0.78,
      fill: pal[scopeOf(m)],
      ring: ringFor(state.key, pal),
      dashed: state.key !== 'fresh',
      dying: state.key === 'dying',
      strength,
      core: strength >= 0.72,
      haloR: starR * (1.3 + strength * 1.7),
      haloO: pal.halo * (0.3 + strength),
      twk: 0.55 + strength * 0.4,
      // 运动性格按种子分配：约一半漫游、四分之一轨道、四分之一冲刺
      mode: ((seed >>> 24) % 4 === 3 ? 2 : (seed >>> 24) % 4 === 2 ? 1 : 0) as 0 | 1 | 2,
      speed: 5 + (seed % 9),
      radius: 14 + ((seed >>> 4) % 21),
      interval: 2 + ((seed >>> 9) % 5) * 0.9,
    }
  })
}

interface MemorySkyHandle {
  fit: () => void
}

const MemorySky = forwardRef<MemorySkyHandle, {
  memories: IMemory[]
  decayDays: number
  forgetDays: number
  dreaming: boolean
  /** 游走开关：true = 萤火虫式随机游走，false = 静止（仅保留呼吸） */
  animate: boolean
  /** 霓虹配色（随明暗主题切换） */
  pal: SkyPalette
  /** 是否暗色主题（悬浮信息框的底色/描边用） */
  isDark: boolean
}>(function MemorySky({ memories, decayDays, forgetDays, dreaming, animate, pal, isDark }, ref) {
  const { ref: boxRef, size, measured } = useElementSize<HTMLDivElement>()
  const stars = useMemo(() => buildSkyStars(memories, decayDays, forgetDays, pal), [memories, decayDays, forgetDays, pal])
  // 悬停：冻结该星的运动并显示信息框（点击不再弹卡）
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const hoverIdRef = useRef<string | null>(null)

  // 无限画布：世界坐标固定，仅镜头（平移 + 缩放）变化
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)
  const fittedRef = useRef(false)
  const starElsRef = useRef<Map<string, SVGGElement>>(new Map())
  const haloElsRef = useRef<Map<string, SVGGElement>>(new Map())
  const trailElsRef = useRef<Map<string, SVGPathElement>>(new Map())
  const walkRef = useRef<Map<string, { x: number; y: number; tx: number; ty: number; nextAt: number; phase: number; hist: { x: number; y: number }[] }>>(new Map())
  const dragWinRef = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null)

  /** 适应内容：把有星的星域（或全部星域锚点）装进视口 */
  const fitTo = useCallback(() => {
    const pts = stars.length > 0
      ? stars.map((s) => ({ x: s.x, y: s.y, r: s.r }))
      : [{ x: 0, y: 0, r: 120 }]
    const pad = 170
    const minX = Math.min(...pts.map((p) => p.x - p.r)) - pad
    const maxX = Math.max(...pts.map((p) => p.x + p.r)) + pad
    const minY = Math.min(...pts.map((p) => p.y - p.r)) - pad
    const maxY = Math.max(...pts.map((p) => p.y + p.r)) + pad
    const scale = Math.min(1.15, Math.max(0.32, Math.min(size.w / (maxX - minX), size.h / (maxY - minY))))
    setCam({
      scale,
      x: size.w / 2 - ((minX + maxX) / 2) * scale,
      y: size.h / 2 - ((minY + maxY) / 2) * scale,
    })
  }, [stars, size])

  useImperativeHandle(ref, () => ({ fit: fitTo }), [fitTo])

  // 首次进入：等容器真实尺寸量到之后再落位（否则会按默认视口居中，呈现偏左上）
  useEffect(() => {
    if (!fittedRef.current && measured) {
      fittedRef.current = true
      fitTo()
    }
  }, [measured, fitTo])

  // 滚轮缩放（以指针为中心）；必须非 passive 才能 preventDefault
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      hoverIdRef.current = null
      setHover(null)
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setCam((prev) => {
        const scale = Math.min(2.6, Math.max(0.3, prev.scale * Math.exp(-e.deltaY * 0.0012)))
        const k = scale / prev.scale
        return { scale, x: px - (px - prev.x) * k, y: py - (py - prev.y) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [boxRef])

  // 萤火虫：三种运动性格（漫游 / 轨道 / 冲刺）+ 霓虹光晕 + 运动轨迹。
  // 全部直接写 DOM，不进 React 状态；关闭开关立即静止并清掉轨迹/光晕残留。
  useEffect(() => {
    const resetVisuals = () => {
      for (const el of starElsRef.current.values()) el.style.transform = ''
      for (const el of haloElsRef.current.values()) el.style.transform = ''
      for (const el of trailElsRef.current.values()) el.setAttribute('d', '')
    }
    if (!animate) {
      resetVisuals()
      return
    }
    let raf = 0
    let last = performance.now()
    let frame = 0
    // 星星正滑向新位置时先不画轨迹（位置是瞬时切换的，会跟星点脱节）
    const holdTrailUntil = performance.now() + SKY_POS_MS
    for (const st of walkRef.current.values()) st.hist.length = 0
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const t = now / 1000
      frame++
      const slowPaint = frame % 2 === 0 // 轨迹/光晕每两帧写一次，减少整组模糊重算
      for (const s of stars) {
        const id = s.memory.id
        const el = starElsRef.current.get(id)
        // 悬停的星：冻结在原位并清掉尾巴（其余星继续飞）
        if (hoverIdRef.current === id) {
          const trail = trailElsRef.current.get(id)
          if (trail && (trail.getAttribute('d') || '') !== '') trail.setAttribute('d', '')
          continue
        }
        let st = walkRef.current.get(id)
        if (!st) {
          st = { x: 0, y: 0, tx: 0, ty: 0, nextAt: 0, phase: (s.i % 7) * 1.3, hist: [] }
          walkRef.current.set(id, st)
        }
        if (s.mode === 1) {
          // 轨道：绕原位缓慢画圈
          const w = 0.08 + (s.speed % 5) * 0.02
          const R = 12 + s.radius * 0.55
          st.x = Math.cos(t * w + st.phase) * R
          st.y = Math.sin(t * w * 1.17 + st.phase) * R * 0.8
        } else {
          if (t >= st.nextAt) {
            const a = Math.random() * Math.PI * 2
            const rr = Math.random() * s.radius * (s.mode === 2 ? 1.5 : 1)
            st.tx = Math.cos(a) * rr
            st.ty = Math.sin(a) * rr
            st.nextAt = t + s.interval * (0.6 + Math.random() * 0.8)
          }
          const dx = st.tx - st.x
          const dy = st.ty - st.y
          const dist = Math.hypot(dx, dy)
          if (dist > 0.4) {
            // 冲刺模式速度快得多，抵达目标后蛰伏到下次换点
            const step = Math.min(s.speed * (s.mode === 2 ? 7 : 1) * dt, dist)
            st.x += (dx / dist) * step
            st.y += (dy / dist) * step
          }
        }
        if (el) el.style.transform = `translate(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px)`
        if (!slowPaint) continue
        // 光晕走位（每两帧写一次，省一次整组模糊重算），与星点始终同向
        const halo = haloElsRef.current.get(id)
        if (halo) halo.style.transform = `translate(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px)`
        // 星星正滑向新位置时先不画轨迹：轨迹用瞬时的新坐标，会跟星点脱节
        if (now < holdTrailUntil) continue
        // 轨迹：保留最近 12 个位置，画成一条霓虹尾巴
        st.hist.push({ x: st.x, y: st.y })
        if (st.hist.length > 12) st.hist.shift()
        const trail = trailElsRef.current.get(id)
        if (trail) {
          const pts = st.hist.map((p) => `${(s.x + p.x).toFixed(1)} ${(s.y + p.y).toFixed(1)}`)
          trail.setAttribute('d', pts.length > 1 ? `M${pts.join('L')}` : '')
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      resetVisuals()
    }
  }, [animate, stars])

  // 卸载时清掉窗口级拖拽监听
  useEffect(() => () => {
    const h = dragWinRef.current
    if (h) {
      window.removeEventListener('pointermove', h.move)
      window.removeEventListener('pointerup', h.up)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = { px: e.clientX, py: e.clientY, moved: false }
    // 拖动即收起悬浮信息并解冻
    hoverIdRef.current = null
    setHover(null)
    // 注意：不 setPointerCapture——捕获会把之后的 click 重定向到容器，导致点星永远失效
    const move = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = ev.clientX - d.px
      const dy = ev.clientY - d.py
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        d.moved = true
        setDragging(true)
      }
      if (!d.moved) return
      d.px = ev.clientX
      d.py = ev.clientY
      setCam((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragWinRef.current = null
      endDrag()
    }
    dragWinRef.current = { move, up }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const endDrag = () => {
    if (drag.current) {
      drag.current = null
      setDragging(false)
    }
  }

  return (
    <div
      ref={boxRef}
      className={`absolute inset-0 touch-none select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={onPointerDown}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => fitTo()}
    >
      <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} className="absolute inset-0">
        <g
          style={{
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
            transformOrigin: '0 0',
            transition: dragging ? 'none' : 'transform .5s cubic-bezier(.22,1,.36,1)',
          }}
        >
          {/* Dream 巩固时的夜波：从全局星域扩散两圈 */}
          {dreaming && (
            <>
              <circle cx={0} cy={0} r={80} className="dream-ripple" />
              <circle cx={0} cy={0} r={80} className="dream-ripple" style={{ animationDelay: '1.1s' }} />
            </>
          )}

          {/* 霓虹运动轨迹：整组做一次模糊（比逐元素 filter 便宜） */}
          <g style={{ filter: 'blur(2px)' }}>
            {stars.map((s) => (
              <path
                key={s.memory.id}
                ref={(el) => {
                  if (el) trailElsRef.current.set(s.memory.id, el)
                  else trailElsRef.current.delete(s.memory.id)
                }}
                fill="none"
                stroke={s.fill}
                strokeWidth={Math.max(1, s.r * 0.42)}
                strokeLinecap="round"
                opacity={pal.trail}
              />
            ))}
          </g>

          {/* 霓虹光晕：赛博荧光的关键一层。位移交给外层 g（走位），圆自身只走布局缓动 */}
          <g style={{ filter: 'blur(5px)' }}>
            {stars.map((s) => (
              <g
                key={s.memory.id}
                ref={(el) => {
                  if (el) haloElsRef.current.set(s.memory.id, el)
                  else haloElsRef.current.delete(s.memory.id)
                }}
              >
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={s.haloR}
                  fill={s.fill}
                  opacity={s.haloO}
                  style={{ transition: SKY_POS_TRANSITION }}
                />
              </g>
            ))}
          </g>

          {stars.map((s) => (
            <g
              key={s.memory.id}
              style={{
                cursor: 'pointer',
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: `starIn .7s cubic-bezier(.22,1,.36,1) ${Math.min(s.i, 24) * 0.035}s both`,
                ['--star-o' as string]: s.opacity,
              } as React.CSSProperties}
              onMouseEnter={(e) => {
                hoverIdRef.current = s.memory.id
                const rect = boxRef.current?.getBoundingClientRect()
                setHover({ id: s.memory.id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
              }}
              onMouseLeave={() => {
                if (hoverIdRef.current === s.memory.id) {
                  hoverIdRef.current = null
                  setHover(null)
                }
              }}
            >
              {/* 萤火虫：随机游走位移由 rAF 直接写 transform（不进状态）+ 常驻呼吸 */}
              <g
                ref={(el) => {
                  if (el) starElsRef.current.set(s.memory.id, el)
                  else starElsRef.current.delete(s.memory.id)
                }}
              >
                <circle
                  cx={s.x} cy={s.y} r={s.r} fill={s.fill}
                  stroke={s.ring} strokeWidth={(s.dying ? 1.6 : 1.2) / cam.scale}
                  strokeDasharray={s.dashed ? `${3 / cam.scale} ${3 / cam.scale}` : undefined}
                  className="star-dot"
                  style={{
                    opacity: 'var(--star-o, 1)',
                    animation: `starTwinkle ${(2.6 + s.strength * 6).toFixed(1)}s ease-in-out ${((s.radius % 7) * 0.5).toFixed(1)}s infinite`,
                    animationPlayState: hover?.id === s.memory.id ? 'paused' : 'running',
                    transition: `${SKY_POS_TRANSITION}, transform .2s ease`,
                    ['--twk' as string]: s.twk,
                  } as React.CSSProperties}
                />
                {s.core && (
                  isDark
                    ? <circle cx={s.x} cy={s.y} r={s.r * 0.42} fill="rgba(255,255,255,0.9)" style={{ transition: SKY_POS_TRANSITION }} />
                    : <circle cx={s.x} cy={s.y} r={s.r * 0.52} fill={s.fill} style={{ transition: SKY_POS_TRANSITION }} />
                )}
                <circle cx={s.x} cy={s.y} r={Math.max(s.r + 8 / cam.scale, 13 / cam.scale)} fill="transparent" style={{ transition: SKY_POS_TRANSITION }} />
              </g>
            </g>
          ))}
        </g>
      </svg>

      {/* 悬浮信息框：鼠标移入星星即冻结该星并就地展示（点击不再弹卡） */}
      {hover && (() => {
        const s = stars.find((x) => x.memory.id === hover.id)
        if (!s) return null
        const st = stateOf(s.memory, decayDays, forgetDays)
        const meta = SCOPE_META[scopeOf(s.memory)]
        const left = Math.min(hover.x + 16, Math.max(8, size.w - 292))
        const top = Math.max(12, Math.min(hover.y - 12, size.h - 184))
        return (
          <div
            className="pointer-events-none absolute z-10 w-[17rem] rounded-xl border p-3 shadow-2xl"
            style={{
              left,
              top,
              backgroundColor: isDark ? 'rgba(12,17,34,0.96)' : 'rgba(255,255,255,0.97)',
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)',
            }}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.fill }} />
              <span className={`truncate text-[11px] font-medium ${pal.label}`}>
                {meta.label}{s.memory.scope === 'Project' && s.memory.projectName ? `·${s.memory.projectName}` : ''}
              </span>
              {s.memory.category && (
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${pal.chipBox} ${pal.quiet}`}>{s.memory.category}</span>
              )}
              <span className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.chip}`}>
                <span className={`h-1 w-1 rounded-full ${st.dot}`} />
                {st.label}
              </span>
            </div>
            <p className={`line-clamp-4 text-[12px] leading-relaxed ${pal.label}`}>{s.memory.content}</p>
            <div className={`mt-2 flex items-center gap-3 text-[10px] ${pal.quiet}`}>
              <span>强度 {Math.round(strengthOf(s.memory) * 100)}%</span>
              <span>想起 {s.memory.accessCount} 次</span>
              <span>{formatTime(s.memory.lastAccessedAt)}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
})

/** 存量数据可能没有 scope（或空串），统一按全局兜底 */
const scopeOf = (m: IMemory): MemoryScope => (m.scope && SCOPE_META[m.scope] ? m.scope : 'Global')

/** 作用域徽标：全局 / 会话 / 项目·项目名 */
function ScopeBadge({ memory }: { memory: IMemory }) {
  const meta = SCOPE_META[scopeOf(memory)]
  const Icon = meta.icon
  const suffix = memory.scope === 'Project' && memory.projectName ? `·${memory.projectName}` : ''
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}>
      <Icon size={10} />
      {meta.label}{suffix}
    </span>
  )
}

export default function MemoriesPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<MemoryScope | 'all'>('all')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newImportance, setNewImportance] = useState(0.5)
  const [newScope, setNewScope] = useState<MemoryScope>('Global')
  const [newProjectId, setNewProjectId] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editImportance, setEditImportance] = useState(0.5)
  const [editScope, setEditScope] = useState<MemoryScope>('Global')
  const [editProjectId, setEditProjectId] = useState('')
  const [dreamMsg, setDreamMsg] = useState<string | null>(null)
  const [sort, setSort] = useState<'recent' | 'strength' | 'created'>('recent')
  // 主视图：记忆星空（默认，创意表达）与列表（高效操作），两者共用同一份筛选结果
  const [view, setView] = useState<'sky' | 'list'>('sky')
  const skyRef = useRef<MemorySkyHandle | null>(null)
  // 主题：星空在明暗两套霓虹配色间切换
  const isDark = useIsDark()
  const pal = isDark ? NEON.dark : NEON.light
  // 星星游走开关（记住选择）：默认游动，关闭后静止只留呼吸
  const [animate, setAnimate] = useState<boolean>(() => localStorage.getItem('memory-sky-motion') !== 'static')
  useEffect(() => {
    localStorage.setItem('memory-sky-motion', animate ? 'motion' : 'static')
  }, [animate])

  const { data: pagedData, isLoading } = useQuery({
    queryKey: ['memories'],
    queryFn: () => memoryService.getAll(1, 500),
  })

  // Dream 配置：拿衰减/遗忘阈值画「生命周期状态」，以及展示上次自动巩固时间
  const { data: dreamConfig } = useQuery({
    queryKey: ['dreamConfig'],
    queryFn: () => settingService.getDreamConfig(),
  })

  // 项目选择器：新建/编辑「项目记忆」时指定归属项目
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: projectService.getAll })

  const { data: searchResults } = useQuery({
    queryKey: ['memories', 'search', searchQuery],
    queryFn: () => memoryService.search(searchQuery, 20),
    enabled: searchQuery.trim().length > 0,
  })

  const createMutation = useMutation({
    mutationFn: memoryService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      setIsCreating(false)
      setNewContent('')
      setNewCategory('')
      setNewImportance(0.5)
      setNewScope('Global')
      setNewProjectId('')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { content: string; category?: string; importance: number; scope?: MemoryScope; projectId?: string } }) =>
      memoryService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      setEditingId(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: memoryService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
  })

  // 手动 Dream：合并重复 / 衰减久未想起 / 遗忘极弱
  const dreamMutation = useMutation({
    mutationFn: () => memoryService.dream(),
    onSuccess: (r) => {
      setDreamMsg(`巩固完成：合并 ${r.merged} · 衰减 ${r.decayed} · 遗忘 ${r.forgotten} · 剩余 ${r.remaining}`)
      queryClient.invalidateQueries({ queryKey: ['memories'] })
      queryClient.invalidateQueries({ queryKey: ['dreamConfig'] })
      setTimeout(() => setDreamMsg(null), 8000)
    },
    onError: (e: Error) => {
      setDreamMsg(`巩固失败：${e.message}`)
      setTimeout(() => setDreamMsg(null), 8000)
    },
  })

  const allMemories = searchQuery.trim() ? (searchResults ?? []) : (pagedData?.items ?? [])

  // 作用域过滤（搜索结果同样按作用域 pill 过滤）
  const scopeCounts = useMemo(() => {
    const map: Record<MemoryScope, number> = { Global: 0, Session: 0, Project: 0 }
    for (const m of allMemories) map[scopeOf(m)]++
    return map
  }, [allMemories])

  const scopedMemories = scopeFilter === 'all'
    ? allMemories
    : allMemories.filter((m) => scopeOf(m) === scopeFilter)

  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of scopedMemories) {
      const key = m.category || '未分类'
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [scopedMemories])

  const memories = activeCategory
    ? scopedMemories.filter((m) => (m.category || '未分类') === activeCategory)
    : scopedMemories

  // 生命周期阈值与「正在衰退」计数（Dream 面板据此提示用户跑一次巩固）
  const decayDays = dreamConfig?.decayDays ?? 30
  const forgetDays = dreamConfig?.forgetDays ?? 180
  const degradingCount = useMemo(
    () => allMemories.filter((m) => stateOf(m, decayDays, forgetDays).key !== 'fresh').length,
    [allMemories, decayDays, forgetDays],
  )

  const sortedMemories = useMemo(() => {
    const arr = [...memories]
    if (sort === 'strength') arr.sort((a, b) => strengthOf(b) - strengthOf(a))
    else if (sort === 'created') arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    else arr.sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime())
    return arr
  }, [memories, sort])

  const handleCreate = () => {
    if (!newContent.trim()) return
    if (newScope === 'Project' && !newProjectId) return
    createMutation.mutate({
      content: newContent.trim(),
      category: newCategory.trim() || undefined,
      importance: newImportance,
      scope: newScope,
      projectId: newScope === 'Project' ? newProjectId : undefined,
    })
  }

  const handleUpdate = (id: string) => {
    if (!editContent.trim()) return
    if (editScope === 'Project' && !editProjectId) return
    updateMutation.mutate({
      id,
      data: {
        content: editContent.trim(),
        category: editCategory.trim() || undefined,
        importance: editImportance,
        scope: editScope,
        projectId: editScope === 'Project' ? editProjectId : undefined,
      },
    })
  }

  const startEdit = (memory: IMemory) => {
    setEditingId(memory.id)
    setEditContent(memory.content)
    setEditCategory(memory.category || '')
    setEditImportance(memory.importance)
    setEditScope(memory.scope ?? 'Global')
    setEditProjectId(memory.projectId ?? '')
  }

  const filterPill = (active: boolean) =>
    active
      ? 'bg-teal-500 text-white shadow-sm shadow-teal-500/20'
      : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        view === 'sky' ? (
          /* 星空模式：整页即星图，控件浮在场景里；配色随明暗主题切换 */
          <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden" style={{ backgroundColor: pal.bg }}>
            {/* 场景光晕：以星团为中心的一团柔光（不再在角落堆几块渐变） */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: isDark
                  ? 'radial-gradient(820px 620px at 50% 50%, rgba(34,211,238,0.16), transparent 62%), radial-gradient(1280px 900px at 50% 50%, rgba(167,139,250,0.1), transparent 70%)'
                  : 'radial-gradient(820px 620px at 50% 50%, rgba(8,145,178,0.13), transparent 62%), radial-gradient(1280px 900px at 50% 50%, rgba(124,58,237,0.08), transparent 70%)',
              }}
            />
            <MemorySky
              ref={skyRef}
              memories={memories}
              decayDays={decayDays}
              forgetDays={forgetDays}
              dreaming={dreamMutation.isPending}
              animate={animate}
              pal={pal}
              isDark={isDark}
            />

            {/* 左上：页面身份与环境说明 */}
            <div className="pointer-events-none absolute left-6 top-6">
              <h1 className={`text-[15px] font-semibold tracking-wide ${pal.label}`}>长期记忆</h1>
              <p className={`mt-1 text-[11px] ${pal.quiet}`}>
                {allMemories.length} 条记忆 · 大小=重要性 · 光晕/亮度=强度 · 描边=状态 · 颜色=作用域 · 由内到外=由强到弱
              </p>
            </div>

            {/* 右上：视图切换 + Dream 巩固 */}
            <div className="absolute right-6 top-6 flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-0.5 rounded-lg p-0.5 ${pal.chipBox}`}>
                  <button
                    onClick={() => setView('sky')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${pal.chipOn}`}
                  >
                    <Sparkles size={12} />星空
                  </button>
                  <button
                    onClick={() => setView('list')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${pal.chipOff}`}
                  >
                    <List size={12} />索引
                  </button>
                </div>
                <div className={`flex items-center gap-0.5 rounded-lg p-0.5 ${pal.chipBox}`}>
                  <button
                    onClick={() => setAnimate(true)}
                    className={animate ? SKY_SCOPE_ACTIVE : SKY_SCOPE_IDLE}
                    title="游动：萤火虫式随机漫游"
                  >
                    <Activity size={12} />游动
                  </button>
                  <button
                    onClick={() => setAnimate(false)}
                    className={animate ? SKY_SCOPE_IDLE : SKY_SCOPE_ACTIVE}
                    title="静止：关闭游走，只保留呼吸"
                  >
                    <Pause size={12} />静态
                  </button>
                </div>
                <button
                  onClick={() => skyRef.current?.fit()}
                  title="适应内容（双击画布同效）"
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-opacity hover:opacity-80 ${pal.chipBox} ${pal.label}`}
                >
                  <Crosshair size={13} />适应
                </button>
                <button
                  onClick={() => dreamMutation.mutate()}
                  disabled={dreamMutation.isPending}
                  title="合并重复、衰减久未想起的、遗忘极弱的记忆（与设置里的自动模式同一逻辑）"
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm shadow-indigo-950/40 transition-colors hover:bg-indigo-400 disabled:opacity-50"
                >
                  {dreamMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
                  {dreamMutation.isPending ? '巩固中…' : 'Dream 巩固'}
                </button>
              </div>
              <p className={`text-[11px] ${pal.quiet}`}>
                {dreamConfig?.enabled
                  ? `自动巩固：每 ${dreamConfig.intervalHours} 小时一次${dreamConfig.lastRunAt ? ` · 上次 ${formatTime(dreamConfig.lastRunAt)}` : ''}`
                  : '自动巩固已关闭（设置 → 记忆 Dream 可开）'}
                {degradingCount > 0 && <span className="text-amber-600 dark:text-amber-300"> · {degradingCount} 条正在衰退</span>}
              </p>
              {dreamMsg && <p className="animate-fade-in text-[11px] text-indigo-500 dark:text-indigo-300">{dreamMsg}</p>}
            </div>

            {/* 底部浮动：作用域筛选 + 语义搜索 */}
            <div className={`absolute bottom-5 left-1/2 flex max-w-[min(94%,46rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border px-3 py-2 shadow-2xl ${pal.border} ${pal.panel}`}>
              {([
                { key: 'all' as const, label: '全部', count: allMemories.length },
                { key: 'Global' as const, label: '全局', count: scopeCounts.Global },
                { key: 'Session' as const, label: '会话', count: scopeCounts.Session },
                { key: 'Project' as const, label: '项目', count: scopeCounts.Project },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setScopeFilter(tab.key); setActiveCategory(null) }}
                  className={scopeFilter === tab.key ? SKY_SCOPE_ACTIVE : SKY_SCOPE_IDLE}
                >
                  {tab.key !== 'all' && (
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: pal[tab.key] }} />
                  )}
                  {tab.label}
                  <span className="text-[10px] opacity-70">{tab.count}</span>
                </button>
              ))}
              <div className="relative mx-1 w-56">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="语义搜索记忆…"
                  className={`w-full rounded-lg border py-1.5 pl-9 pr-3 text-[13px] outline-none transition-colors focus:border-teal-400/60 ${pal.inputBox}`}
                />
              </div>
              <span className={`mr-1 hidden text-[10px] lg:inline ${pal.quiet}`}>拖拽平移 · 滚轮缩放 · 悬停查看</span>
            </div>

            {/* 悬停信息在星星旁就地弹出；点击不再弹卡，编辑/删除请切到「索引」视图 */}
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-8 py-8">
            {/* 页头 */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-sm shadow-teal-500/20">
                  <Atom size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">长期记忆</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">全局 / 会话 / 项目三层记忆：对话自动提取、检索强化、Dream 巩固</p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{pagedData?.totalCount ?? 0}</b> 条记忆</span>
                {categories.length > 0 && (
                  <>
                    <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                    <span><b className="text-sm font-semibold text-teal-600 dark:text-teal-400">{categories.length}</b> 个类别</span>
                  </>
                )}
              </div>
              <button
                onClick={() => setView('sky')}
                title="回到记忆星空"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600"
              >
                <Sparkles size={14} />星空
              </button>
            </div>

            {/* Dream 巩固面板：索引模式下与星空模式共用同一份巩固能力 */}
            <div className="mb-4 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-violet-50/50 to-white p-4 dark:border-indigo-500/20 dark:from-indigo-950/40 dark:via-violet-950/20 dark:to-transparent">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 dark:bg-indigo-400/15 dark:text-indigo-300">
                  <Moon size={17} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-indigo-900 dark:text-indigo-100">记忆巩固 · Dream</p>
                  <p className="mt-0.5 text-[11px] text-indigo-700/75 dark:text-indigo-300/75">
                    {dreamConfig?.enabled
                      ? `自动巩固：每 ${dreamConfig.intervalHours} 小时一次${dreamConfig.lastRunAt ? ` · 上次 ${formatTime(dreamConfig.lastRunAt)}` : ''}`
                      : '自动巩固已关闭（可在 设置 → 记忆 Dream 打开）'}
                    {degradingCount > 0 && ` · ${degradingCount} 条正在衰退`}
                  </p>
                </div>
                <button
                  onClick={() => dreamMutation.mutate()}
                  disabled={dreamMutation.isPending}
                  title="合并重复、衰减久未想起的、遗忘极弱的记忆（与设置里的自动模式同一逻辑）"
                  className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm shadow-indigo-500/20 transition-colors hover:bg-indigo-600 disabled:opacity-50"
                >
                  {dreamMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
                  {dreamMutation.isPending ? '巩固中…' : '立即巩固'}
                </button>
              </div>
              {dreamMsg && (
                <p className="mt-3 animate-fade-in rounded-lg bg-white/70 px-3 py-2 text-xs text-indigo-800 dark:bg-white/[0.05] dark:text-indigo-200">
                  {dreamMsg}
                </p>
              )}
            </div>

            {/* 作用域分段：全局公共 / 会话私有 / 项目内 */}
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  { key: 'all' as const, label: '全部', icon: Atom, count: allMemories.length },
                  { key: 'Global' as const, label: '全局', icon: Globe, count: scopeCounts.Global },
                  { key: 'Session' as const, label: '会话', icon: MessagesSquare, count: scopeCounts.Session },
                  { key: 'Project' as const, label: '项目', icon: FolderInput, count: scopeCounts.Project },
                ]).map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.key}
                      onClick={() => { setScopeFilter(tab.key); setActiveCategory(null) }}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(scopeFilter === tab.key)}`}
                    >
                      <Icon size={13} />
                      {tab.label}
                      <span className="text-[11px] opacity-70">{tab.count}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 工具栏：分类筛选 + 排序 + 搜索 + 新建 */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setActiveCategory(null)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === null)}`}
                >
                  全部
                  <span className="text-[11px] opacity-70">{pagedData?.totalCount ?? 0}</span>
                </button>
                {categories.map(([cat, count]) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === cat)}`}
                  >
                    {cat}
                    <span className="text-[11px] opacity-70">{count}</span>
                  </button>
                ))}
              </div>
              <div className="relative min-w-[180px] max-w-xs flex-1">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="语义搜索记忆..."
                  className="w-full rounded-full border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:ring-teal-950/40"
                />
              </div>
              {view === 'list' && (
                <div className="w-[7.5rem] shrink-0">
                  <Select
                    value={sort}
                    onChange={(v) => setSort(v as 'recent' | 'strength' | 'created')}
                    options={[
                      { value: 'recent', label: '最近想起' },
                      { value: 'strength', label: '最牢固' },
                      { value: 'created', label: '最新创建' },
                    ]}
                    triggerClassName="flex w-full items-center justify-between gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-600 outline-none focus:border-teal-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                  />
                </div>
              )}
              <button
                onClick={() => setIsCreating(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-teal-500/20 transition-all hover:shadow-md active:scale-[0.97]"
              >
                <Plus size={16} />
                新建记忆
              </button>
            </div>

            {/* 记忆列表（列表视图：高效操作模式） */}
            {view === 'list' && (isLoading ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
              </div>
            ) : sortedMemories.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
                  <Brain size={36} className="opacity-50" />
                </div>
                <p className="text-sm font-medium">
                  {searchQuery.trim()
                    ? '没有找到匹配的记忆'
                    : activeCategory
                      ? '该类别下暂无记忆'
                      : scopeFilter !== 'all'
                        ? '该作用域下暂无记忆'
                        : '还没有记忆'}
                </p>
                {!searchQuery.trim() && !activeCategory && scopeFilter === 'all' && (
                  <p className="mt-1.5 max-w-xs text-center text-xs text-gray-400 dark:text-gray-500">
                    对话与 Code 会话会自动提取；也可以点「新建记忆」手动记一条。检索命中会让记忆变牢固，Dream 巩固会合并相似、遗忘无用的。
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {sortedMemories.map((memory) => {
                  const state = stateOf(memory, decayDays, forgetDays)
                  return (
                  <div
                    key={memory.id}
                    className={`group rounded-2xl border bg-white p-4 transition-all duration-200 hover:shadow-md dark:bg-gray-900 ${
                      state.key === 'dying'
                        ? 'border-red-200/80 hover:border-red-300 dark:border-red-500/25 dark:hover:border-red-500/40'
                        : state.key === 'fading'
                          ? 'border-amber-200/70 hover:border-amber-300 dark:border-amber-500/20 dark:hover:border-amber-500/40'
                          : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700'
                    }`}
                  >
                    {editingId === memory.id ? (
                      /* 编辑模式 */
                      <div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="mb-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-teal-950/40"
                        />
                        <div className="mb-3 flex flex-wrap gap-3">
                          <div className="min-w-[140px]">
                            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">作用域</label>
                            <Select
                              value={editScope}
                              onChange={(v) => {
                                setEditScope(v as MemoryScope)
                                if (v !== 'Project') setEditProjectId('')
                              }}
                              options={[
                                { value: 'Global', label: '全局' },
                                ...(memory.topicId ? [{ value: 'Session', label: '会话（本对话）' }] : []),
                                { value: 'Project', label: '项目' },
                              ]}
                              triggerClassName="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-400 dark:border-gray-600 dark:bg-gray-800"
                            />
                          </div>
                          {editScope === 'Project' && (
                            <div className="min-w-[160px] flex-1">
                              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">归属项目</label>
                              <Select
                                value={editProjectId}
                                onChange={setEditProjectId}
                                placeholder="选择项目"
                                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                                triggerClassName="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-400 dark:border-gray-600 dark:bg-gray-800"
                              />
                            </div>
                          )}
                        </div>
                        <div className="mb-3 flex flex-wrap gap-3">
                          <div className="min-w-[160px] flex-1">
                            <input
                              type="text"
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              placeholder="类别"
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                          <div className="w-40">
                            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">重要性: {editImportance.toFixed(1)}</label>
                            <input
                              type="range"
                              min={0.1}
                              max={1}
                              step={0.1}
                              value={editImportance}
                              onChange={(e) => setEditImportance(parseFloat(e.target.value))}
                              className="w-full accent-teal-500"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-xl px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => handleUpdate(memory.id)}
                            className="flex items-center gap-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm shadow-teal-500/20 transition-all hover:shadow-md"
                          >
                            <Save size={14} />
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* 查看模式：状态 + 强度 + 想起记录 */
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <ScopeBadge memory={memory} />
                          {memory.category && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${getCategoryColor(memory.category)}`}>
                              <Tag size={10} />
                              {memory.category}
                            </span>
                          )}
                          <span
                            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${state.chip}`}
                            title="距上次被想起的时间；超过衰减/遗忘阈值会随 Dream 弱化或清除"
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
                            {state.label}
                          </span>
                        </div>
                        <p className="mb-3 max-w-[68ch] text-[15px] leading-relaxed text-gray-800 dark:text-gray-200">{memory.content}</p>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-gray-100 pt-2.5 dark:border-gray-800">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400 dark:text-gray-500">
                            <StrengthMeter memory={memory} />
                            <span title="被检索注入上下文的次数，越常想起越牢固">想起 {memory.accessCount} 次</span>
                            <span title={formatDateTime(memory.lastAccessedAt)}>最近想起 {formatTime(memory.lastAccessedAt)}</span>
                            <span>{memory.source === 'conversation' ? '对话提取' : memory.source === 'work' ? 'Code 提取' : '手动创建'}</span>
                            {memory.score != null && (
                              <span className="text-teal-500">相关度 {(memory.score * 100).toFixed(0)}%</span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              onClick={() => startEdit(memory)}
                              className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
                              title="编辑"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => {
                                confirm({ message: '确定删除这条记忆？', onConfirm: () => deleteMutation.mutate(memory.id) })
                              }}
                              className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-white/[0.06] dark:hover:text-red-400"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        )
      }
    >
      {/* 新建记忆对话框 */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsCreating(false)}>
          <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Atom size={18} className="text-teal-500" />
                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">新建记忆</h3>
              </div>
              <button onClick={() => setIsCreating(false)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">内容</label>
                <textarea
                  autoFocus
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="输入要记住的事实或偏好..."
                  rows={4}
                  className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-teal-950/40"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">作用域</label>
                  <Select
                    value={newScope}
                    onChange={(v) => {
                      setNewScope(v as MemoryScope)
                      if (v !== 'Project') setNewProjectId('')
                    }}
                    options={[
                      { value: 'Global', label: '全局（公共记忆）' },
                      { value: 'Project', label: '项目（项目内记忆）' },
                    ]}
                    triggerClassName="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-gray-600 dark:bg-gray-800"
                  />
                </div>
                {newScope === 'Project' && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">归属项目</label>
                    <Select
                      value={newProjectId}
                      onChange={setNewProjectId}
                      placeholder="选择项目"
                      options={projects.map((p) => ({ value: p.id, label: p.name }))}
                      triggerClassName="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-400 dark:border-gray-600 dark:bg-gray-800"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">类别</label>
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="如：偏好、身份、工作"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-teal-950/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  重要性: {newImportance.toFixed(1)}
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.1}
                  value={newImportance}
                  onChange={(e) => setNewImportance(parseFloat(e.target.value))}
                  className="w-full accent-teal-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => setIsCreating(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!newContent.trim() || createMutation.isPending || (newScope === 'Project' && !newProjectId)}
                className="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-teal-500/20 transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createMutation.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
