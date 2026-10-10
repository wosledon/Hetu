import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Database, Trash2, RefreshCw, ShieldCheck, ShieldOff, Plus } from 'lucide-react'
import { workProjectService } from '../../services/workService'
import { mcpService } from '../../services/mcpService'
import { skillService } from '../../services/skillService'
import { useConfirm } from '../../components/confirm'
import Select from '../Select'
import type { IWorkProject } from '../../types/work'

interface WorkProjectSettingsProps {
  project: IWorkProject
  onClose: () => void
}

/** 项目级设置：MCP 服务器、技能白名单、诊断命令与代码索引管理。 */
export default function WorkProjectSettings({ project, onClose }: WorkProjectSettingsProps) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [mcpIds, setMcpIds] = useState<string[]>(project.mcpServerIds ?? [])
  const [skillIds, setSkillIds] = useState<string[]>(project.skillIds ?? [])
  const [diagnosticsCommand, setDiagnosticsCommand] = useState(project.diagnosticsCommand ?? '')
  const [message, setMessage] = useState('')
  const [ruleTool, setRuleTool] = useState('')
  const [rulePattern, setRulePattern] = useState('')
  const [ruleDecision, setRuleDecision] = useState<'allow' | 'deny'>('allow')

  const { data: mcpServers = [] } = useQuery({ queryKey: ['mcpServers'], queryFn: mcpService.getAll })
  const { data: skills = [] } = useQuery({ queryKey: ['localSkills'], queryFn: skillService.getLocalSkills })

  const { data: approvalRules = [] } = useQuery({
    queryKey: ['workApprovalRules', project.id],
    queryFn: () => workProjectService.getApprovalRules(project.id),
  })

  const createRule = useMutation({
    mutationFn: () =>
      workProjectService.createApprovalRule(project.id, {
        toolName: ruleTool.trim(),
        pathPattern: rulePattern.trim() || undefined,
        decision: ruleDecision,
      }),
    onSuccess: () => {
      setMessage(t('projectSettings.ruleAdded'))
      setRuleTool('')
      setRulePattern('')
      queryClient.invalidateQueries({ queryKey: ['workApprovalRules', project.id] })
    },
    onError: (e: Error) => setMessage(t('projectSettings.addRuleFailed', { error: e.message })),
  })

  const deleteRule = useMutation({
    mutationFn: workProjectService.deleteApprovalRule,
    onSuccess: () => {
      setMessage(t('projectSettings.ruleDeleted'))
      queryClient.invalidateQueries({ queryKey: ['workApprovalRules', project.id] })
    },
    onError: (e: Error) => setMessage(t('projectSettings.deleteRuleFailed', { error: e.message })),
  })

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
      setMessage(t('common:saved'))
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    },
    onError: (e: Error) => setMessage(t('projectSettings.saveFailed', { error: e.message })),
  })

  const rebuildIndex = useMutation({
    mutationFn: () => workProjectService.indexCode(project.id, false),
    onSuccess: (result) => {
      setMessage(t('projectSettings.indexDone', { files: result.indexedFiles, chunks: result.indexedChunks }))
      queryClient.invalidateQueries({ queryKey: ['workCodeIndex', project.id] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    },
    onError: (e: Error) => setMessage(t('projectSettings.indexFailed', { error: e.message })),
  })

  const clearIndex = useMutation({
    mutationFn: () => workProjectService.clearCodeIndex(project.id),
    onSuccess: () => {
      setMessage(t('projectSettings.indexCleared'))
      queryClient.invalidateQueries({ queryKey: ['workCodeIndex', project.id] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
    },
    onError: (e: Error) => setMessage(t('projectSettings.clearIndexFailed', { error: e.message })),
  })

  const handleClearIndex = () => {
    confirm({
      message: t('projectSettings.clearIndexConfirm'),
      onConfirm: () => clearIndex.mutate(),
    })
  }

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('projectSettings.title', { name: project.name })}</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">{t('projectSettings.rootPath')}</label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-[12px] text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              {project.rootPath}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">{t('projectSettings.diagnosticsCommand')}</label>
            <input
              value={diagnosticsCommand}
              onChange={(e) => setDiagnosticsCommand(e.target.value)}
              placeholder={t('projectSettings.diagnosticsPlaceholder')}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12px] outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
            />
            <p className="mt-1 text-[11px] text-gray-400">{t('projectSettings.diagnosticsHint')}</p>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">
              {t('projectSettings.mcpServers', { count: mcpIds.length })}
            </label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
              {mcpServers.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-gray-400">{t('projectSettings.noMcpServers')}</p>}
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
              {t('projectSettings.skills', { count: skillIds.length })}
            </label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
              {skills.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-gray-400">{t('projectSettings.noLocalSkills')}</p>}
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
            <label className="mb-1 block text-[12px] font-medium text-gray-600 dark:text-gray-300">
              {t('projectSettings.approvalRules', { count: approvalRules.length })}
            </label>
            <div className="space-y-1 rounded-lg border border-gray-200 p-1.5 dark:border-gray-700">
              {approvalRules.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-gray-400">{t('projectSettings.noRules')}</p>
              )}
              {approvalRules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-white/[0.04]">
                  {rule.decision === 'allow' ? (
                    <ShieldCheck size={12} className="shrink-0 text-emerald-500" />
                  ) : (
                    <ShieldOff size={12} className="shrink-0 text-rose-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">
                    {rule.toolName}
                    {rule.pathPattern && <span className="text-gray-400"> · {rule.pathPattern}</span>}
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${rule.decision === 'allow' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>
                    {rule.decision === 'allow' ? t('projectSettings.allow') : t('projectSettings.deny')}
                  </span>
                  <button
                    onClick={() => confirm({
                      message: t('projectSettings.deleteRuleConfirm', { name: rule.toolName }),
                      onConfirm: () => deleteRule.mutate(rule.id),
                    })}
                    className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-rose-500 dark:hover:bg-gray-800"
                    title={t('projectSettings.deleteRule')}
                    aria-label={t('projectSettings.deleteRule')}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1 border-t border-gray-100 px-1.5 pt-1.5 dark:border-gray-800">
                <input
                  value={ruleTool}
                  onChange={(e) => setRuleTool(e.target.value)}
                  list="work-tool-names"
                  placeholder={t('projectSettings.toolName')}
                  className="min-w-0 flex-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-1 font-mono text-[11px] outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
                />
                <datalist id="work-tool-names">
                  {['work_list_dir', 'work_read_file', 'work_write_file', 'work_run_command', 'work_task', 'work_diagnostics', 'work_semantic_search', 'work_skill'].map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <input
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                  placeholder={t('projectSettings.pathPattern')}
                  className="min-w-0 flex-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[11px] outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
                />
                <Select
                  value={ruleDecision}
                  onChange={(value) => setRuleDecision(value as 'allow' | 'deny')}
                  options={[
                    { value: 'allow', label: t('projectSettings.allow') },
                    { value: 'deny', label: t('projectSettings.deny') },
                  ]}
                  triggerClassName="flex w-[70px] shrink-0 items-center justify-between gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] outline-none dark:border-gray-700 dark:bg-gray-800"
                />
                <button
                  onClick={() => ruleTool.trim() && createRule.mutate()}
                  disabled={!ruleTool.trim() || createRule.isPending}
                  className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/40"
                >
                  {createRule.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  {t('common:add')}
                </button>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">{t('projectSettings.rulesHint')}</p>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-gray-600 dark:text-gray-300">
              <Database size={12} /> {t('projectSettings.codeIndex')}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 dark:border-gray-700">
              <span className="min-w-0 flex-1 text-[11px] text-gray-500 dark:text-gray-400">
                {indexStatus?.isReady
                  ? t('projectSettings.indexStats', { files: indexStatus.fileCount, chunks: indexStatus.chunkCount })
                  : t('projectSettings.indexNone')}
                {indexStatus?.isReady && indexStatus.refreshPending && (
                  <span className="ml-1 text-blue-500 dark:text-blue-400">{t('projectSettings.indexing')}</span>
                )}
                {indexStatus?.isReady && !indexStatus.refreshPending && indexStatus.isStale && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">{t('projectSettings.staleFiles', { count: indexStatus.staleFileCount })}</span>
                )}
              </span>
              <button
                onClick={() => rebuildIndex.mutate()}
                disabled={rebuildIndex.isPending}
                className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                {rebuildIndex.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {t('projectSettings.rebuild')}
              </button>
              <button
                onClick={handleClearIndex}
                disabled={clearIndex.isPending || !indexStatus?.isReady}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-gray-800"
                title={t('projectSettings.clearIndex')}
                aria-label={t('projectSettings.clearIndex')}
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
            {t('common:save')}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>
  )
}
