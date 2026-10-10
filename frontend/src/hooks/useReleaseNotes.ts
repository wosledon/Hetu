import { useEffect, useState } from 'react'
import { fetchReleaseNotes, type ReleaseNotes } from '../services/releaseNotesService'

/** 当前版本的发布说明（本地缓存，GitHub 不通时走加速镜像；取不到返回 null） */
export function useReleaseNotes(version: string | null): { notes: ReleaseNotes | null; loading: boolean } {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!version) return
    let alive = true
    setLoading(true)
    void fetchReleaseNotes(version)
      .then((result) => { if (alive) setNotes(result) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [version])

  return { notes, loading }
}
