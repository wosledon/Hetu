import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Folder, FolderOpen, HardDrive, Home, Loader2, CornerLeftUp, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { systemService } from '../services/systemService'

interface FolderPickerDialogProps {
  /** 初始路径（已有目录时定位到这里） */
  initialPath?: string
  title?: string
  onClose: () => void
  onPick: (path: string) => void
}

/**
 * 前端目录选择器：面包屑 + 目录列表，纯前端交互（后端只提供目录列举）。
 * 双击进入子目录，单击选中，确定返回当前路径。
 */
export default function FolderPickerDialog({ initialPath, title, onClose, onPick }: FolderPickerDialogProps) {
  const { t } = useTranslation()
  const dialogTitle = title ?? t('ui:folderPicker.title')
  const [path, setPath] = useState(initialPath ?? '')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['systemFsDirs', path],
    queryFn: () => systemService.listDirs(path || undefined),
  })

  // 选中项只在当前目录列表里有效：切目录或列表刷新后自动失效（派生值，无需在 effect 里同步重置）
  const selected = selectedPath && data?.dirs.some((d) => d.path === selectedPath) ? selectedPath : null

  const open = (p: string) => { setPath(p); setSelectedPath(null) }

  const segments = data?.current
    ? data.current.replace(/\//g, '\\').split('\\').filter(Boolean)
    : []

  const crumbs: { name: string; path: string }[] = []
  if (data?.current) {
    let acc = ''
    const isWindows = data.current.includes('\\')
    for (const seg of segments) {
      acc = isWindows ? (acc ? `${acc}\\${seg}` : `${seg}\\`) : `${acc}/${seg}`
      crumbs.push({ name: seg, path: acc })
    }
  }

  const current = data?.current ?? ''
  const isRootList = !current

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex h-[520px] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3.5 dark:border-gray-700">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <FolderOpen size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{dialogTitle}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
        </div>

        {/* 面包屑 */}
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-gray-100 px-4 py-2 text-[12px] dark:border-gray-700">
          {isRootList ? (
            <span className="text-gray-400">{t('ui:folderPicker.thisPc')}</span>
          ) : (
            <>
              <button onClick={() => open('')} className="shrink-0 rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" title={t('ui:folderPicker.thisPc')}>
                <HardDrive size={13} />
              </button>
              {crumbs.map((c, i) => (
                <div key={c.path} className="flex shrink-0 items-center">
                  {i > 0 && <ChevronRight size={12} className="text-gray-300 dark:text-gray-600" />}
                  <button
                    onClick={() => open(c.path)}
                    className="max-w-[140px] truncate rounded px-1.5 py-0.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    title={c.path}
                  >
                    {c.name}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* 目录列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-gray-400"><Loader2 size={20} className="animate-spin" /></div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-red-500">{(error as Error).message}</div>
          ) : (
            <>
              {!isRootList && data?.parent !== undefined && data?.parent !== null && (
                <button
                  onClick={() => open(data.parent!)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <CornerLeftUp size={14} className="shrink-0" />
                  {t('ui:folderPicker.parent')}
                </button>
              )}
              {isRootList && (
                <button
                  onClick={() => open(data?.dirs.find(d => d.name === '主目录' || d.path === '/')?.path ?? '/')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <Home size={14} className="shrink-0" />
                  {t('ui:folderPicker.home')}
                </button>
              )}
              {(data?.dirs.length ?? 0) === 0 && !isLoading && (
                <div className="py-10 text-center text-xs text-gray-400">{t('ui:folderPicker.empty')}</div>
              )}
              {data?.dirs.map((d) => (
                <button
                  key={d.path}
                  onClick={() => setSelectedPath(d.path)}
                  onDoubleClick={() => open(d.path)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    selected === d.path
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <Folder size={14} className={`shrink-0 ${selected === d.path ? 'text-amber-500' : 'text-gray-400'}`} />
                  <span className="min-w-0 flex-1 truncate">{isRootList ? d.path : d.name}</span>
                  {selected !== d.path && <ChevronRight size={12} className="shrink-0 text-gray-300 dark:text-gray-600" />}
                </button>
              ))}
            </>
          )}
        </div>

        {/* 底部：当前路径 + 操作 */}
        <div className="shrink-0 space-y-2.5 border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900">
            <Folder size={13} className="shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-600 dark:text-gray-300" title={selected ?? current}>
              {selected ?? current ?? t('ui:folderPicker.pickHint')}
            </span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
              {t('common:cancel')}
            </button>
            <button
              onClick={() => onPick(selected ?? current)}
              disabled={!selected && !current}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-amber-600 disabled:opacity-40"
            >
              {t('ui:folderPicker.pickCurrent')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
