import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { agentService } from '../services/agentService'

/**
 * 权限模式清单：后端是唯一来源（值 / 名称 / 说明），按当前语言缓存。
 * 列表在运行期不会变化，staleTime 设为 Infinity，语言切换时重新拉取本地化文案。
 */
export function useAgentPermissionModes() {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: ['agentPermissionModes', i18n.language],
    queryFn: agentService.getPermissionModes,
    staleTime: Infinity,
  })
}