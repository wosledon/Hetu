import { useEffect, useMemo, useState } from 'react'
import { AppWindow, BookOpen, Code, GitBranch, Layers, MessageSquare, ShieldCheck, Star } from 'lucide-react'
import { systemService } from '../services/systemService'
import { isTauri } from '../utils/tauri'

const ABOUT_FEATURES = [
  { icon: BookOpen, label: '笔记与知识库', desc: '双链笔记、标签、图谱与语义检索' },
  { icon: MessageSquare, label: 'AI 对话', desc: '多模型对话、工具调用、深度思考、长期记忆' },
  { icon: Code, label: 'Code 模式', desc: '编码 Agent：读写文件、执行命令、检查点回滚、SSH 远程项目' },
  { icon: GitBranch, label: '工作流', desc: '可视化编排 AI 与工具节点，支持人工审批' },
  { icon: Layers, label: '技能与智能体', desc: '/技能 快捷指令、本地技能目录、智能体预设' },
  { icon: AppWindow, label: '应用', desc: '内嵌打开各大模型的免费网页对话' },
]

const ABOUT_STACK = [
  { label: '后端', value: 'ASP.NET Core 10 · EF Core 10 · Serilog' },
  { label: '数据库', value: 'SQLite（默认）· PostgreSQL + pgvector（可选）' },
  { label: '前端', value: 'React 19 · TypeScript · Tailwind CSS · Vite' },
  { label: '桌面壳', value: 'Tauri 2（可选，内嵌后端子进程）' },
  { label: '向量检索', value: 'sqlite-vec / pgvector，余弦相似度' },
]

/** 设置页「关于」：产品定位、核心能力、技术栈与运行环境 */
export default function AboutSection({ appName }: { appName: string }) {
  const [version, setVersion] = useState<string | null>(null)
  const runtime = useMemo(() => ({
    apiBase: `${window.location.protocol}//${window.location.host}`,
    isDesktop: isTauri(),
  }), [])

  // 版本号启动时从后端读取（与桌面壳 tauri.conf.json 同源）
  useEffect(() => {
    let alive = true
    systemService.getVersion()
      .then((info) => { if (alive) setVersion(info?.version ?? null) })
      .catch(() => { /* 读取失败时仅不展示版本号 */ })
    return () => { alive = false }
  }, [])

  return (
    <section className="space-y-8">
      {/* 产品标识 */}
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl border border-gray-100 bg-gray-50/80 shadow-sm dark:border-white/20 dark:bg-white">
          <img
            src="/brand.png"
            alt=""
            width={92}
            height={92}
            draggable={false}
            className="h-[92px] w-[92px] select-none object-contain"
          />
        </div>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 text-xl font-bold text-gray-900 dark:text-gray-100">
            {appName}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              {version ? `v${version}` : '…'}
            </span>
          </h2>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            AI 增强知识管理工具 —— 笔记 + 对话双引擎，数据本地优先
          </p>
        </div>
      </div>

      {/* 产品简介 */}
      <div className="space-y-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        <p>
          {appName} 把<strong className="font-medium text-gray-800 dark:text-gray-200">知识管理</strong>与<strong className="font-medium text-gray-800 dark:text-gray-200">AI 对话</strong>合为一体：
          用双链笔记和图谱沉淀个人知识，用多模型对话、技能与工作流把知识变成生产力。
          所有数据默认存储在本地（SQLite），支持导出备份，API Key 仅保存在本机并加密保护。
        </p>
        <p>
          Code 模式提供编码 Agent，可直接读写项目文件、执行开发命令、按权限模式请求确认，并通过 SSH 操作远程项目；
          「应用」菜单还能把各家大模型的免费网页对话内嵌到应用内使用。
        </p>
      </div>

      {/* 核心能力 */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">核心能力</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {ABOUT_FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.label} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-500 shadow-sm dark:bg-white/[0.06] dark:text-blue-400">
                  <Icon size={15} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{f.label}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-gray-400">{f.desc}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 技术栈 */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">技术栈</h3>
        <dl className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-white/[0.06] dark:border-white/[0.06]">
          {ABOUT_STACK.map((row) => (
            <div key={row.label} className="flex items-baseline gap-4 px-4 py-2.5">
              <dt className="w-20 shrink-0 text-[12px] font-medium text-gray-500 dark:text-gray-400">{row.label}</dt>
              <dd className="min-w-0 flex-1 text-[13px] text-gray-700 dark:text-gray-200">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 运行环境 */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">运行环境</h3>
        <dl className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-white/[0.06] dark:border-white/[0.06]">
          <div className="flex items-baseline gap-4 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-[12px] font-medium text-gray-500 dark:text-gray-400">运行模式</dt>
            <dd className="text-[13px] text-gray-700 dark:text-gray-200">{runtime.isDesktop ? '桌面应用（Tauri）' : '浏览器访问'}</dd>
          </div>
          <div className="flex items-baseline gap-4 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-[12px] font-medium text-gray-500 dark:text-gray-400">服务地址</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-700 dark:text-gray-200">{runtime.apiBase}</dd>
          </div>
        </dl>
      </div>

      {/* 隐私与开源 */}
      <div className="space-y-2.5 rounded-xl bg-blue-50/70 p-4 dark:bg-blue-950/20">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-blue-800 dark:text-blue-200">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          <span>
            本地优先：笔记、对话、记忆与向量索引都存放在本机数据库中；API Key 加密后仅保存在本机，不会上传到任何第三方服务器。
          </span>
        </p>
        <button
          onClick={() => window.open('https://github.com/wosledon/Hetu', '_blank', 'noopener')}
          className="flex items-center gap-1.5 text-[12px] font-medium text-blue-700 transition-colors hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
        >
          <Star size={13} />
          在 GitHub 上查看源码
        </button>
      </div>
    </section>
  )
}
