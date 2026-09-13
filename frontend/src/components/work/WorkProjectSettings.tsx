import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Database, Trash2, RefreshCw } from 'lucide-react'
import { workProjectService } from '../../services/workService'
import { mcpService } from '../../services/mcpService'
import { skillService } from '../../services/skillService'
import type { IWorkProject } from '../../types/work'

interface WorkProjectSettingsProps {
  project: IWorkProject
  onClose: () => void
}

/** 项目级设置：MCP 服务器、技能白名单、诊断命令与代码索引管理。 */
export default function WorkProjectSettings({ project, onClose }: WorkProjectSettingsProps) {
  const queryClient = useQueryClient()
  const [mcpIds, setMcpIds] = useState<string[]>(project.mcpServerIds ?? [])
  const [skillIds, setSkillIds] = useState<string[]>(project.skillIds ?? [])
  const [diagnosticsCommand, setDiagnosticsCommand] = useState(project.diagnosticsCommand ?? '')
  const [message, setMessage] = useState('')

  const { data: mcpServers = [] } = useQuery({ queryKey: ['mcpServers'], queryFn: mcpService.getAll })
  const { data: skills = [] } = useQuery({ queryKey: ['localSkills'], queryFn: skillService.getLocalSkills })

  const { data: indexStatus } = useQuery({
    queryKey: ['workCodeIndex', project.id],
    queryFn: () => workProjectService.getCodeIndexStatus(project.id),
    // 后台自动刷新期间轮询状态，刷新完成后停止
    refetchInterval: (query) => (query.state.data?.refreshPending ? 3000 : false),
  })

  const save = useMutation({
    mutationFn: () =>
      workProjectService.update(project.id, {
        name: project.name,
        rootPath: project.rootPath,
        description: project.description,
        icon: project.icon,
        color: project.color,
        sortOrder: project.sortOrder,
        mcpServerIds: mcpIds,
        skillIds,
        diagnosticsCommand: diagnosticsCommand.trim(),
      }),
    onSuccess: () => {
      setMessage('已保存')
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    },
    onError: (e: Error) => setMessage(`保存失败：${e.message}`),
  })

  const rebuildIndex = useMutation({
    mutationFn: () => workProjectService.indexCode(project.id, false),
    onSuccess: (result) => {
      setMessage(`索引完成：${result.indexedFiles} 个文件 / ${result.indexedChunks} 个片段`)
      queryClient.invalidateQueries({ queryKey: ['workCodeIndex', project.id] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    },
    onError: (e: Error) => setMessage(`索引失败：${e.message}`),
  })

  const clearIndex = useMutation({
    mutationFn: () => workProjectService.clearCodeIndex(project.id),
    onSuccess: () => {
      setMessage('索引已清空')
      queryClient.invalidateQueries({ queryKey: ['workCodeIndex', project.id] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    },
  })

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">项目设置 · {project.name}</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">根目录</label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-[12px] text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              {project.rootPath}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">诊断命令</label>
            <input
              value={diagnosticsCommand}
              onChange={(e) => setDiagnosticsCommand(e.target.value)}
              placeholder="留空则按项目类型自动识别，如 npm run build / dotnet build"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12px] outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
            />
            <p className="mt-1 text-[11px] text-gray-400">Agent 调用「构建诊断」工具时优先执行该命令。</p>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">
              MCP 服务器（{mcpIds.length} 个已启用）
            </label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
              {mcpServers.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-gray-400">未配置 MCP 服务器</p>}
              {mcpServers.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={mcpIds.includes(s.id)}
                    onChange={() => toggle(mcpIds, setMcpIds, s.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">{s.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{s.type}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">
              技能（{skillIds.length} 个已启用）
            </label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
              {skills.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-gray-400">未发现本地技能</p>}
              {skills.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={skillIds.includes(s.id)}
                    onChange={() => toggle(skillIds, setSkillIds, s.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">{s.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{s.category}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-gray-600 dark:text-gray-300">
              <Database size={12} /> 代码语义索引
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 dark:border-gray-700">
              <span className="min-w-0 flex-1 text-[11px] text-gray-500 dark:text-gray-400">
                {indexStatus?.isReady
                  ? `${indexStatus.fileCount} 个文件 / ${indexStatus.chunkCount} 个片段`
                  : '尚未建立索引（建立后可用语义检索代码）'}
                {indexStatus?.isReady && indexStatus.refreshPending && (
                  <span className="ml-1 text-blue-500 dark:text-blue-400">· 正在后台刷新</span>
                )}
                {indexStatus?.isReady && !indexStatus.refreshPending && indexStatus.isStale && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">· {indexStatus.staleFileCount} 个文件已变更，待刷新</span>
                )}
              </span>
              <button
                onClick={() => rebuildIndex.mutate()}
                disabled={rebuildIndex.isPending}
                className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                {rebuildIndex.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                重建
              </button>
              <button
                onClick={() => clearIndex.mutate()}
                disabled={clearIndex.isPending || !indexStatus?.isReady}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-gray-800"
                title="清空索引"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
          {message && <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500 dark:text-gray-400">{message}</span>}
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="ml-auto rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40"
          >
            保存
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
