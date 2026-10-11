import { useEffect, useState } from 'react'
import { fetchReleaseNotes, type ReleaseNotes } from '../services/releaseNotesService'

/** 当前版本的发布说明（本地缓存，GitHub 不通时走加速镜像；取不到返回 null） */
export function useReleaseNotes(version: string | null): { notes: ReleaseNotes | null; loading: boolean } {
  // 只记录「哪个版本已回填」，loading 由它推导：避免在 effect 里同步 setState 触发级联渲染
  const [loaded, setLoaded] = useState<{ version: string; notes: ReleaseNotes | null } | null>(null)

  useEffect(() => {
    if (!version) return
    let alive = true
    void fetchReleaseNotes(version).then(
      (result) => { if (alive) setLoaded({ version, notes: result }) },
      () => { if (alive) setLoaded({ version, notes: null }) },
    )
    return () => { alive = false }
  }, [version])

  if (!version) return { notes: null, loading: false }
  return loaded?.version === version
    ? { notes: loaded.notes, loading: false }
    : { notes: null, loading: true }
}
