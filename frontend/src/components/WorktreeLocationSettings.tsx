import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Loader2, RotateCcw, Save } from 'lucide-react'
import { settingService } from '../services/settingService'

/**
 * Code 工作树位置：默认统一放在仓库父目录的 .hetu-worktrees 下（按仓库名分子目录，父目录只多这一个文件夹）；
 * 也可指定别的根目录，软件自己按「仓库名/工作树名」管理子目录。
 */
export default function WorktreeLocationSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  // 表单草稿记录「基于哪个服务端值编辑」：服务端值变化时自动对齐（派生值，替代 effect 里同步 setState）
  const [edit, setEdit] = useState<{ base: string; value: string } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const { data: config, isLoading } = useQuery({
    queryKey: ['worktreeConfig'],
    queryFn: () => settingService.getWorktreeConfig(),
  })

  const savedRoot = config?.rootDirectory ?? ''
  const draft = edit && edit.base === savedRoot ? edit.value : savedRoot
  const dirty = draft !== savedRoot

  const saveMutation = useMutation({
    mutationFn: (rootDirectory: string) => settingService.setWorktreeConfig({ rootDirectory: rootDirectory.trim() || undefined }),
    onSuccess: (_data, saved) => {
      setEdit({ base: saved.trim(), value: saved.trim() })
      setMessage(null)
      queryClient.invalidateQueries({ queryKey: ['worktreeConfig'] })
    },
    onError: (e: Error) => setMessage(e.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-gray-400" />
        <span className="text-sm text-gray-500">{t('common:loading')}</span>
      </div>
    )
  }

  const save = (value: string) => {
    setMessage(null)
    saveMutation.mutate(value)
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-50">
          <FolderGit2 size={17} className="text-emerald-500" />
          {t('worktreeLocation.title')}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('worktreeLocation.subtitle')}</p>
      </div>

      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('worktreeLocation.rootLabel')}</label>
        <div className="flex items-center gap-2">
          <input
            value={draft}
            placeholder={t('worktreeLocation.placeholder')}
            onChange={(e) => setEdit({ base: savedRoot, value: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[12px] outline-none focus:border-indigo-300 dark:border-gray-600 dark:bg-gray-700"
          />
          <button
            onClick={() => {
              setEdit(null)
              save('')
            }}
            disabled={saveMutation.isPending}
            title={t('worktreeLocation.resetTitle')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[12px] text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            <RotateCcw size={13} />
            {t('worktreeLocation.reset')}
          </button>
          <button
            onClick={() => save(draft)}
            disabled={saveMutation.isPending || !dirty}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-50"
          >
            {saveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {t('worktreeLocation.save')}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">{t('worktreeLocation.hint')}</p>

        {message && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-300">{message}</p>}

        {config?.exampleRoot && (
          <div className="mt-3 space-y-1 rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
            <p>{t('worktreeLocation.exampleRoot', { path: config.exampleRoot })}</p>
            {config.examplePath && <p>{t('worktreeLocation.examplePath', { path: config.examplePath })}</p>}
          </div>
        )}
      </div>
    </section>
  )
}
