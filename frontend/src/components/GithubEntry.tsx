import { useTranslation } from 'react-i18next'
import { openRepo, REPO_URL } from '../utils/repo'
import { isTauri } from '../utils/tauri'

/** GitHub 标记（lucide 已移除品牌图标，这里内联官方轮廓） */
export function GithubMark({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

/** GitHub 仓库入口：垂直胶囊排在「设置」上方，顶部横栏排在「设置」左侧。
 *  用真实链接（`<a target="_blank">`）而不是 window.open：内嵌浏览器/扩展常拦脚本弹窗，
 *  锚点最稳；桌面壳的 webview 会拦掉新窗口，所以壳内拦截点击交给系统 opener。 */
export default function GithubEntry({ variant }: { variant: 'top' | 'rail' | 'railList' }) {
  const { t } = useTranslation()
  const title = t('nav:github')

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isTauri()) return
    e.preventDefault()
    openRepo()
  }

  if (variant !== 'top') {
    const list = variant === 'railList'
    return (
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        title={title}
        data-rail-item=""
        className={
          list
            ? 'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-gray-400 transition-all hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
            : 'flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium text-gray-400 transition-all hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
        }
      >
        <GithubMark size={list ? 16 : 18} />
        <span className="max-w-full truncate">{t('nav:githubShort')}</span>
      </a>
    )
  }

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      title={title}
      className="rounded-lg p-2 text-gray-400 transition-all hover:bg-gray-100/60 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
    >
      <GithubMark size={17} />
    </a>
  )
}
