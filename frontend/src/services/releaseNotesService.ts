const REPO = 'wosledon/Hetu'
const CACHE_PREFIX = 'hetu-release-notes-'

export interface ReleaseNotes {
  version: string
  /** 发布说明正文（Markdown 原文） */
  body: string
  publishedAt?: string
}

/**
 * 取某个版本的发布说明（用于「本版本更新内容」，即使没有新版本也能看）。
 * GitHub API 不通时依次尝试加速镜像；全部失败返回 null（界面只显示一句提示）。
 */
export async function fetchReleaseNotes(version: string): Promise<ReleaseNotes | null> {
  const tag = `v${version.replace(/^v/, '')}`
  const cacheKey = `${CACHE_PREFIX}${tag}`

  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as ReleaseNotes
      if (parsed?.body) return parsed
    }
  } catch {
    // 缓存损坏：继续走网络
  }

  const url = `https://api.github.com/repos/${REPO}/releases/tags/${tag}`
  const sources = [url, `https://gh-proxy.com/${url}`, `https://ghproxy.net/${url}`]

  for (const source of sources) {
    try {
      const response = await fetch(source, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) continue
      const data = (await response.json()) as { body?: string; published_at?: string; tag_name?: string }
      const body = (data?.body ?? '').trim()
      if (!body) continue
      const notes: ReleaseNotes = { version: data.tag_name ?? tag, body, publishedAt: data.published_at }
      try {
        localStorage.setItem(cacheKey, JSON.stringify(notes))
      } catch {
        // 忽略缓存写入失败（隐私模式等）
      }
      return notes
    } catch {
      // 源不可达：试下一个
    }
  }
  return null
}
