import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign, ImagePlus, Plus, Wand2 } from 'lucide-react'
import { POPOVER_PANEL_CLASS, popoverItemClass } from '../../utils/styles'

export interface AgentPlusMenuProps {
  /** 选择图片后回调（可多选） */
  onFiles: (files: File[]) => void
  /** 插入 @ 并打开引用浮层 */
  onMention: () => void
  /** 插入 / 并打开技能 / 模板浮层 */
  onSlash: () => void
}

/**
 * 输入框左下角的“+”面板：图片附件、@ 引用、/ 技能与模板。
 * 只做入口，具体解析仍复用输入框已有的 @ / / 浮层与附件 chip。
 */
export default function AgentPlusMenu({ onFiles, onMention, onSlash }: AgentPlusMenuProps) {
  const { t } = useTranslation('agent')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? undefined : t('input.plus.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-owner={open ? '' : undefined}
        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md transition-colors ${
          open
            ? 'bg-gray-100 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200'
        }`}
      >
        <Plus size={15} className={`transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>

      {open && (
        <div role="menu" className={`absolute bottom-full left-0 z-50 mb-2 w-52 p-1.5 ${POPOVER_PANEL_CLASS}`}>
          <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('input.plus.addToChat')}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(() => fileRef.current?.click())}
            className={popoverItemClass(false)}
          >
            <ImagePlus size={15} className="mt-0.5 shrink-0 text-blue-500" />
            <span className="min-w-0 flex-1 text-xs font-medium">{t('input.plus.addImage')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onMention)}
            className={popoverItemClass(false)}
          >
            <AtSign size={15} className="mt-0.5 shrink-0 text-emerald-500" />
            <span className="min-w-0 flex-1 text-xs font-medium">{t('input.plus.mention')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onSlash)}
            className={popoverItemClass(false)}
          >
            <Wand2 size={15} className="mt-0.5 shrink-0 text-violet-500" />
            <span className="min-w-0 flex-1 text-xs font-medium">{t('input.plus.slash')}</span>
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </div>
  )
}