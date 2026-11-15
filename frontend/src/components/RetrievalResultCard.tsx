import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight, Database, Globe2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type RetrievalResultKind = 'web' | 'knowledge' | 'memory'

export interface RetrievalResult {
  title?: string
  url?: string
  snippet?: string
  content?: string
  category?: string
}

interface RetrievalResultCardProps {
  kind: RetrievalResultKind
  results: RetrievalResult[]
}

const CONFIG = {
  web: {
    icon: Globe2,
    label: 'shared.sources',
    tone: 'text-blue-500 dark:text-blue-400',
    link: 'text-blue-600 dark:text-blue-400',
  },
  knowledge: {
    icon: Database,
    label: 'shared.knowledgeSources',
    tone: 'text-amber-500 dark:text-amber-400',
    link: 'text-amber-600 dark:text-amber-400',
  },
  memory: {
    icon: Brain,
    label: 'shared.memorySources',
    tone: 'text-violet-500 dark:text-violet-400',
    link: 'text-violet-600 dark:text-violet-300',
  },
} as const

/** 联网 / 知识库 / 记忆来源：默认单行折叠，展开后显示紧凑来源列表。 */
export default function RetrievalResultCard({ kind, results }: RetrievalResultCardProps) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)
  if (results.length === 0) return null

  const config = CONFIG[kind]
  const Icon = config.icon
  const first = results[0]
  const preview = first.title ?? first.content ?? first.url ?? ''

  return (
    <div className="mt-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-6 w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-gray-50/80 dark:hover:bg-white/[0.025]"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-400">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <Icon size={13} className={`shrink-0 ${config.tone}`} />
        <span className="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {t(config.label)} · {results.length}
        </span>
        {preview && <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400 dark:text-gray-500" title={preview}>{preview}</span>}
      </button>
      {open && (
        <div className="ml-5 max-h-56 space-y-1 overflow-y-auto border-l border-gray-200/80 py-1 pl-3 dark:border-white/[0.08]">
          {results.map((result, index) => {
            const title = result.title ?? result.content ?? result.url ?? ''
            const detail = kind === 'web' ? result.url : result.snippet
            const row = (
              <>
                <span className={`block truncate text-[11px] font-medium ${config.link}`} title={title}>{title}</span>
                {detail && <span className="block truncate text-[10px] text-gray-400 dark:text-gray-500" title={detail}>{detail}</span>}
                {result.category && <span className="block text-[10px] text-gray-400 dark:text-gray-500">{result.category}</span>}
              </>
            )
            return result.url ? (
              <a
                key={result.url || index}
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded px-1 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.025]"
              >
                {row}
              </a>
            ) : (
              <div key={`${title}-${index}`} className="px-1 py-1">{row}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}
