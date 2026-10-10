import { useQuery } from '@tanstack/react-query'
import { systemService } from '../services/systemService'

/** 应用版本号（来自后端 /api/system/version，与桌面壳 tauri.conf.json 同源） */
export function useAppVersion(): string | null {
  const { data } = useQuery({
    queryKey: ['system-version'],
    queryFn: () => systemService.getVersion(),
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return data?.version ?? null
}
