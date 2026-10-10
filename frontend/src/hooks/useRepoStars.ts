import { useEffect, useState } from 'react'

const REPO_API = 'https://api.github.com/repos/wosledon/Hetu'
const CACHE_KEY = 'hetu-repo-stars'
const CACHE_TTL = 6 * 60 * 60 * 1000

type CachedStars = { count: number; at: number }

function readCache(): CachedStars | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedStars
    return typeof parsed?.count === 'number' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 仓库 star 数：本地缓存 6 小时，GitHub API 不通时依次尝试加速镜像；
 * 全部失败就返回 null（界面只显示图标，不显示数字）。
 */
export function useRepoStars(): number | null {
  const [count, setCount] = useState<number | null>(() => readCache()?.count ?? null)

  useEffect(() => {
    const cached = readCache()
    if (cached && Date.now() - cached.at < CACHE_TTL) return

    let alive = true
    const sources = [REPO_API, `https://gh-proxy.com/${REPO_API}`, `https://ghproxy.net/${REPO_API}`]

    void (async () => {
      for (const url of sources) {
        try {
          const response = await fetch(url, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(8000),
          })
          if (!response.ok) continue
          const data = (await response.json()) as { stargazers_count?: unknown }
          if (typeof data?.stargazers_count !== 'number') continue
          localStorage.setItem(CACHE_KEY, JSON.stringify({ count: data.stargazers_count, at: Date.now() }))
          if (alive) setCount(data.stargazers_count)
          return
        } catch {
          // 源不可达：试下一个
        }
      }
    })()

    return () => { alive = false }
  }, [])

  return count
}

/** 打开 GitHub 仓库（桌面壳走系统浏览器 / opener 插件） */
export function openRepo() {
  window.open('https://github.com/wosledon/Hetu', '_blank', 'noopener')
}
