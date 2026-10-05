import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, Loader2, X, Globe, GitCompare, GitBranch, GitCommitHorizontal, FileCode, PanelRightClose, History, RotateCcw, Search, Save, Sparkles, Diff, Trash2, Quote } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'
import { workFileService, workSessionService, workCheckpointService, workProjectService, workGitService } from '../../services/workService'
import { useConfirm } from '../../components/confirm'
import { useUIStore } from '../../stores/uiStore'
import type { IWorkFileEntry, IWorkFileContent, IWorkFileChange, IWorkCheckpoint, IWorkCheckpointDiff, IWorkCodeSearchHit } from '../../types/work'
import WorkDiffView from './WorkDiffView'
import WorkCheckpointDiffView from './WorkCheckpointDiffView'

interface WorkExplorerProps {
  projectId?: string
  sessionId?: string
  onCollapse?: () => void
  /** 当前打开的文件路径变化（供对话区显示引用 chip） */
  onActiveFileChange?: (path: string | null) => void
  /** 打开指定文件请求（来自对话区点击路径） */
  openFileRequest?: { path: string; nonce: number } | null
  /** 把编辑器选中代码加入对话上下文 */
  onAddSelectionContext?: (path: string, text: string) => void
  /** 在编辑器当前标签光标处插入文本（来自对话代码块动作） */
  insertRequest?: { text: string; path?: string; nonce: number } | null
}

interface TreeNode extends IWorkFileEntry {
  children?: TreeNode[]
  loaded?: boolean
}

type NavTab = 'files' | 'changes' | 'checkpoints' | 'browser' | 'git'

const GIT_STATUS_META: Record<string, { label: string; cls: string }> = {
  M: { label: '修改', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  A: { label: '新增', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  D: { label: '删除', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  R: { label: '重命名', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  '??': { label: '未跟踪', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
}

interface OpenTab {
  key: string
  label: string
  kind: 'file' | 'diff' | 'checkpoint'
  file?: IWorkFileContent
  change?: IWorkFileChange
  checkpoint?: IWorkCheckpointDiff
}

export default function WorkExplorer({ projectId, sessionId, onCollapse, onActiveFileChange, openFileRequest, onAddSelectionContext, insertRequest }: WorkExplorerProps) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loadedDirs, setLoadedDirs] = useState<Map<string, TreeNode[]>>(new Map())
  const [tab, setTab] = useState<NavTab>('files')
  const [browserUrl, setBrowserUrl] = useState('')
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'text' | 'semantic'>('text')
  const [restoreMessage, setRestoreMessage] = useState('')
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map())
  const [saveMessage, setSaveMessage] = useState('')
  const [actionError, setActionError] = useState('')

  const { data: changes = [] } = useQuery({
    queryKey: ['workFileChanges', sessionId],
    queryFn: () => (sessionId ? workSessionService.getFileChanges(sessionId) : Promise.resolve([])),
    enabled: !!sessionId,
  })

  const { data: checkpoints = [] } = useQuery({
    queryKey: ['workCheckpoints', sessionId],
    queryFn: () => (sessionId ? workSessionService.getCheckpoints(sessionId) : Promise.resolve([])),
    enabled: !!sessionId,
  })

  const { data: gitStatus, refetch: refetchGit, isFetching: isGitLoading } = useQuery({
    queryKey: ['workGitStatus', projectId],
    queryFn: () => workGitService.status(projectId!),
    enabled: !!projectId && tab === 'git',
  })
  const [gitSelected, setGitSelected] = useState<Set<string>>(new Set())
  const [gitCommitMessage, setGitCommitMessage] = useState('')
  const [gitMessage, setGitMessage] = useState('')

  const gitCommit = useMutation({
    mutationFn: () => workGitService.commit(projectId!, gitCommitMessage.trim(), [...gitSelected]),
    onSuccess: (result) => {
      setGitMessage(result.output || '已提交')
      setGitCommitMessage('')
      setGitSelected(new Set())
      void refetchGit()
    },
    onError: (e: Error) => setGitMessage(`提交失败：${e.message}`),
  })

  const searchTerm = searchQuery.trim()

  const { data: searchHits = [], isFetching: isSearching } = useQuery({
    queryKey: ['workFileSearch', projectId, searchTerm],
    queryFn: () => workFileService.search(projectId!, searchTerm, 80),
    enabled: !!projectId && searchTerm.length >= 2 && searchMode === 'text',
  })

  const { data: codeHits = [], isFetching: isCodeSearching } = useQuery({
    queryKey: ['workCodeSearch', projectId, searchTerm],
    queryFn: () => workProjectService.searchCode(projectId!, searchTerm, 12),
    enabled: !!projectId && searchTerm.length >= 2 && searchMode === 'semantic',
  })

  const { data: indexStatus } = useQuery({
    queryKey: ['workCodeIndex', projectId],
    queryFn: () => workProjectService.getCodeIndexStatus(projectId!),
    enabled: !!projectId && searchMode === 'semantic',
  })

  const saveFile = useMutation({
    mutationFn: (payload: { key: string; path: string; content: string; originalContent: string }) =>
      workFileService.write(projectId!, payload.path, payload.content, payload.originalContent),
    onSuccess: (saved, payload) => {
      setTabs((prev) => prev.map((t) => (t.key === payload.key && t.file ? { ...t, file: saved } : t)))
      setDrafts((prev) => {
        const next = new Map(prev)
        next.delete(payload.key)
        return next
      })
      setSaveMessage(`已保存 ${payload.path}`)
      setTimeout(() => setSaveMessage(''), 2500)
      queryClient.invalidateQueries({ queryKey: ['workDirEntries', projectId] })
    },
    onError: (error: Error) => setSaveMessage(`保存失败：${error.message}`),
  })

  const restoreCheckpoint = useMutation({
    mutationFn: (id: string) => workCheckpointService.restore(id),
    onSuccess: (result) => {
      setRestoreMessage(
        `已恢复 ${result.restoredCount} 个文件，删除 ${result.deletedCount} 个文件` +
          (result.errors.length > 0 ? `，${result.errors.length} 项失败` : ''),
      )
      queryClient.invalidateQueries({ queryKey: ['workFileChanges', sessionId] })
      if (projectId) queryClient.invalidateQueries({ queryKey: ['workDirEntries', projectId] })
    },
    onError: (e: Error) => setRestoreMessage(`回滚失败：${e.message}`),
  })

  /** diff 还原/应用：把指定版本内容写回工作区（不传 originalContent，跳过冲突校验） */
  const writeFileContent = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      workFileService.write(projectId!, path, content, undefined),
    onSuccess: (_r, { path }) => {
      setSaveMessage(`已写入 ${path}`)
      setTimeout(() => setSaveMessage(''), 2500)
      if (projectId) queryClient.invalidateQueries({ queryKey: ['workDirEntries', projectId] })
      queryClient.invalidateQueries({ queryKey: ['workFileChanges', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['workGitStatus', projectId] })
    },
    onError: (e: Error) => setSaveMessage(`写入失败：${e.message}`),
  })

  const handleRevertChange = (change: IWorkFileChange, label: string) => {
    confirm({
      message: `确定把 ${change.filePath} ${label}吗？磁盘上的当前内容将被覆盖。`,
      onConfirm: () => writeFileContent.mutate({ path: change.filePath, content: change.oldContent ?? '' }),
    })
  }

  const handleApplyChange = (change: IWorkFileChange) => {
    confirm({
      message: `确定把该版本内容写入 ${change.filePath} 吗？磁盘上的当前内容将被覆盖。`,
      onConfirm: () => writeFileContent.mutate({ path: change.filePath, content: change.newContent }),
    })
  }

  const deleteCheckpoint = useMutation({
    mutationFn: workCheckpointService.delete,
    onSuccess: (_result, checkpointId) => {
      setRestoreMessage('检查点已删除')
      queryClient.invalidateQueries({ queryKey: ['workCheckpoints', sessionId] })
      setTabs((prev) => prev.filter((t) => t.key !== `cp:${checkpointId}`))
    },
    onError: (e: Error) => setRestoreMessage(`删除检查点失败：${e.message}`),
  })

  const loadDir = useCallback(async (path: string) => {
    if (!projectId) return []
    const entries = await workFileService.list(projectId, path || undefined)
    return entries
  }, [projectId])

  const rootQuery = useQuery({
    queryKey: ['workDirEntries', projectId, ''],
    queryFn: () => loadDir(''),
    enabled: !!projectId,
  })

  // 根目录来自查询结果，子目录按路径缓存，两者拼装成展示用的树
  const tree = useMemo(() => {
    const attach = (nodes: TreeNode[], parent: string): TreeNode[] =>
      nodes.map((n) => {
        const path = parent ? `${parent}/${n.name}` : n.name
        const children = n.isDirectory ? loadedDirs.get(path) : undefined
        return children ? { ...n, loaded: true, children: attach(children, path) } : n
      })
    return attach(rootQuery.data ?? [], '')
  }, [rootQuery.data, loadedDirs])

  const openFileTab = async (nodePath: string, name: string) => {
    if (!projectId) return
    const key = `file:${nodePath}`
    // 已在标签页则直接切换
    if (tabs.some((t) => t.key === key)) {
      setActiveKey(key)
      setSelectedPath(nodePath)
      return
    }
    try {
      const content = await workFileService.read(projectId, nodePath)
      const newTab: OpenTab = { key, label: name, kind: 'file', file: content }
      setTabs((prev) => [...prev, newTab])
      setActiveKey(key)
      setSelectedPath(nodePath)
      setActionError('')
      setTab('files')
      onActiveFileChange?.(nodePath)
    } catch (e) {
      setActionError(`打开文件失败：${(e as Error).message || '未知错误'}`)
    }
  }

  const openDiffTab = (change: IWorkFileChange) => {
    const key = `diff:${change.id}`
    if (tabs.some((t) => t.key === key)) {
      setActiveKey(key)
      return
    }
    const name = change.filePath.split('/').pop() ?? change.filePath
    setTabs((prev) => [...prev, { key, label: `${name} (diff)`, kind: 'diff', change }])
    setActiveKey(key)
  }

  const openCheckpointDiffTab = async (cp: IWorkCheckpoint) => {
    const key = `cp:${cp.id}`
    if (tabs.some((t) => t.key === key)) {
      setActiveKey(key)
      return
    }
    try {
      const diff = await workCheckpointService.diff(cp.id)
      setTabs((prev) => [...prev, { key, label: `${cp.label} (差异)`, kind: 'checkpoint', checkpoint: diff }])
      setActiveKey(key)
    } catch { setRestoreMessage('读取检查点差异失败') }
  }

  /** 打开 Git 工作区差异：旧内容取 HEAD 版本，新内容取磁盘当前文件 */
  const openGitDiffTab = async (file: { path: string; status: string }) => {
    if (!projectId) return
    const key = `diff:git:${file.path}`
    if (tabs.some((t) => t.key === key)) {
      setActiveKey(key)
      return
    }
    try {
      const content = await workGitService.fileContent(projectId, file.path)
      const action = file.status === '??' || file.status === 'A' ? 'create' : file.status === 'D' ? 'delete' : 'write'
      const change: IWorkFileChange = {
        id: `git:${file.path}`,
        projectId,
        filePath: file.path,
        oldContent: content.oldContent ?? '',
        newContent: content.newContent ?? '',
        action,
        createdAt: new Date().toISOString(),
      }
      const name = file.path.split('/').pop() ?? file.path
      setTabs((prev) => [...prev, { key, label: `${name} (git)`, kind: 'diff', change }])
      setActiveKey(key)
    } catch (e) {
      setActionError(`读取 Git 差异失败：${(e as Error).message || '未知错误'}`)
    }
  }

  const draftOf = (tab: OpenTab) => drafts.get(tab.key) ?? tab.file?.content ?? ''

  const activeTab = tabs.find((t) => t.key === activeKey)

  const saveActiveTab = useCallback(() => {
    if (!activeTab || activeTab.kind !== 'file' || !activeTab.file || !projectId) return
    const content = drafts.get(activeTab.key)
    if (content === undefined) return
    saveFile.mutate({
      key: activeTab.key,
      path: activeTab.file.path,
      content,
      originalContent: activeTab.file.content ?? '',
    })
  }, [activeTab, drafts, projectId, saveFile])

  // Ctrl/Cmd+S 保存当前文件：经 ref 调用最新回调，监听器只注册一次
  const saveActiveTabRef = useRef<() => void>(() => {})
  useEffect(() => { saveActiveTabRef.current = saveActiveTab }, [saveActiveTab])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      saveActiveTabRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 对话区点击路径 → 打开文件
  const lastOpenNonce = useRef(0)
  useEffect(() => {
    if (!openFileRequest || openFileRequest.nonce === lastOpenNonce.current) return
    lastOpenNonce.current = openFileRequest.nonce
    const name = openFileRequest.path.split('/').pop() ?? openFileRequest.path
    void openFileTab(openFileRequest.path, name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFileRequest])

  // 关闭当前活动文件标签时清除引用
  useEffect(() => {
    if (!activeKey) onActiveFileChange?.(null)
  }, [activeKey, onActiveFileChange])

  // 对话代码块"插入到编辑器"
  const editorViewRef = useRef<EditorView | null>(null)
  const pendingInsertRef = useRef<string | null>(null)
  const insertAtCursor = (text: string) => {
    const view = editorViewRef.current
    if (!view || !activeTab || activeTab.kind !== 'file' || !activeTab.file) return
    const { from } = view.state.selection.main
    const current = draftOf(activeTab)
    const next = current.slice(0, from) + text + current.slice(from)
    setDrafts((prev) => new Map(prev).set(activeTab.key, next))
    setSaveMessage('已插入到编辑器')
    setTimeout(() => setSaveMessage(''), 2000)
  }
  const lastInsertNonce = useRef(0)
  /* 以下两个 effect 是"外部事件 → 状态同步"的指令式通道（对话代码块插入编辑器），
     不是渲染派生副作用，故按设计关闭 set-state-in-effect / exhaustive-deps 检查 */
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!insertRequest || insertRequest.nonce === lastInsertNonce.current) return
    lastInsertNonce.current = insertRequest.nonce
    if (insertRequest.path && insertRequest.path !== activeTab?.file?.path) {
      // 目标文件未打开：先打开再插入
      pendingInsertRef.current = insertRequest.text
      const name = insertRequest.path.split('/').pop() ?? insertRequest.path
      void openFileTab(insertRequest.path, name)
      return
    }
    insertAtCursor(insertRequest.text)
  }, [insertRequest])
  useEffect(() => {
    if (!pendingInsertRef.current || !activeTab || activeTab.kind !== 'file') return
    const text = pendingInsertRef.current
    pendingInsertRef.current = null
    insertAtCursor(text)
  }, [activeTab?.key])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const quoteSelection = () => {
    const view = editorViewRef.current
    if (!view || !activeTab || activeTab.kind !== 'file' || !activeTab.file) return
    const { from, to } = view.state.selection.main
    if (from === to) {
      setSaveMessage('请先在编辑器中选择代码')
      setTimeout(() => setSaveMessage(''), 2000)
      return
    }
    const text = view.state.sliceDoc(from, to)
    if (text.length > 8000) {
      setSaveMessage('选中内容过大（>8000 字符）')
      setTimeout(() => setSaveMessage(''), 2000)
      return
    }
    onAddSelectionContext?.(activeTab.file.path, text)
    setSaveMessage('已加入对话上下文')
    setTimeout(() => setSaveMessage(''), 2000)
  }

  const closeTab = (key: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key)
      if (idx < 0) return prev
      const next = prev.filter((t) => t.key !== key)
      if (activeKey === key) {
        const neighbor = next[Math.max(0, idx - 1)] ?? next[0]
        setActiveKey(neighbor ? neighbor.key : null)
      }
      return next
    })
  }

  const toggleNode = async (node: TreeNode, parentPath: string) => {
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
    if (!node.isDirectory) {
      openFileTab(nodePath, node.name)
      return
    }

    const willExpand = !expanded.has(nodePath)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(nodePath)) next.delete(nodePath)
      else next.add(nodePath)
      return next
    })

    if (willExpand && !loadedDirs.has(nodePath)) {
      try {
        const children = await loadDir(nodePath)
        setLoadedDirs((prev) => new Map(prev).set(nodePath, children))
        setActionError('')
      } catch (e) {
        setActionError(`读取目录失败：${(e as Error).message || '未知错误'}`)
      }
    }
  }

  const renderNode = (node: TreeNode, parentPath: string, depth: number) => {
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
    const isOpen = expanded.has(nodePath)
    const isSelected = selectedPath === nodePath

    if (node.name === 'node_modules' || node.name === '.git' || node.name === 'dist' || node.name === 'bin' || node.name === 'obj' || node.name === 'target') {
      if (depth > 0 && !isOpen) return null
    }

    return (
      <div key={nodePath}>
        <div
          onClick={() => toggleNode(node, parentPath)}
          className={`group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-[3px] transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-100 dark:hover:bg-white/[0.04]'}`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
        >
          {node.isDirectory ? (
            <>
              {isOpen ? <ChevronDown size={11} className="shrink-0 text-gray-400" /> : <ChevronRight size={11} className="shrink-0 text-gray-400" />}
              <Folder size={13} className="shrink-0 text-amber-500" />
            </>
          ) : (
            <>
              <span className="w-[11px] shrink-0" />
              <File size={13} className="shrink-0 text-gray-400" />
            </>
          )}
          <span className={`min-w-0 flex-1 truncate text-[12px] ${isSelected ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>
            {node.name}
          </span>
        </div>
        {node.isDirectory && isOpen && node.children?.map((child) => renderNode(child, nodePath, depth + 1))}
      </div>
    )
  }

  const langFor = (name: string) => {
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) return javascript({ jsx: ext === '.jsx' || ext === '.tsx', typescript: ext === '.ts' || ext === '.tsx' })
    if (ext === '.py') return python()
    if (['.css', '.scss', '.less'].includes(ext)) return css()
    if (['.html', '.htm', '.vue', '.svelte', '.xml'].includes(ext)) return html()
    if (['.json', '.jsonc'].includes(ext)) return json()
    if (['.md', '.mdx'].includes(ext)) return markdown()
    return undefined
  }

  const themeMode = useUIStore((s) => s.theme)
  const isDark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const editorBaseTheme = EditorView.theme({
    '&': { height: '100%', fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
    '&.cm-focused': { outline: 'none' },
  })

  const navBtn = (t: NavTab, label: string, Icon: React.ComponentType<{ size?: number }>) => (
    <button
      onClick={() => setTab(t)}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${tab === t ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.04]'}`}
    >
      <Icon size={12} /> {label}
    </button>
  )

  return (
    <div className="flex min-w-0 flex-1 border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* 左侧导航：文件 / 更改 / 浏览器 */}
      <div className="flex w-64 shrink-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-gray-100 px-2 dark:border-gray-800">
          {navBtn('files', '文件', Folder)}
          {navBtn('changes', '更改', GitCompare)}
          {navBtn('checkpoints', '检查点', History)}
          {navBtn('git', 'Git', GitBranch)}
          {navBtn('browser', '浏览器', Globe)}
          <button onClick={() => { setLoadedDirs(new Map()); setExpanded(new Set()); void rootQuery.refetch() }} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]">
            <RefreshCw size={12} />
          </button>
          <button onClick={onCollapse} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]" title="折叠面板">
            <PanelRightClose size={12} />
          </button>
        </div>

        {tab === 'browser' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex gap-1 border-b border-gray-100 p-1.5 dark:border-gray-800">
              <input
                value={browserUrl}
                onChange={(e) => setBrowserUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                placeholder="输入 URL（http://...）"
                className="min-w-0 flex-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
              />
            </div>
            <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-gray-400">
              <div>
                <Globe size={24} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p>内嵌浏览器需要 CSP 与后端代理支持</p>
                <p className="mt-1 text-[10px]">输入 http(s):// 地址回车加载</p>
              </div>
            </div>
          </div>
        ) : tab === 'changes' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {changes.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-gray-400">暂无文件修改</div>
            )}
            {changes.map((change) => {
              const name = change.filePath.split('/').pop() ?? change.filePath
              return (
                <div
                  key={change.id}
                  onClick={() => openDiffTab(change)}
                  className="group mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.04]"
                >
                  <GitCompare size={13} className="shrink-0 text-indigo-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">{name}</div>
                    <div className="truncate text-[10px] text-gray-400">{change.filePath}</div>
                  </div>
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                    change.action === 'create'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : change.action === 'delete'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  }`}>
                    {change.action === 'create' ? '新增' : change.action === 'delete' ? '删除' : '修改'}
                  </span>
                </div>
              )
            })}
          </div>
        ) : tab === 'checkpoints' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {restoreMessage && (
              <div className="mb-1.5 rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
                {restoreMessage}
              </div>
            )}
            {!sessionId && (
              <div className="px-2 py-8 text-center text-xs text-gray-400">选择会话后查看检查点</div>
            )}
            {sessionId && checkpoints.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-gray-400">暂无检查点（Agent 修改文件前会自动创建）</div>
            )}
            {checkpoints.map((cp) => (
              <div
                key={cp.id}
                className="group mb-0.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2">
                  <History size={13} className="shrink-0 text-sky-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-gray-700 dark:text-gray-200">{cp.label}</div>
                    <div className="truncate text-[10px] text-gray-400">
                      {new Date(cp.createdAt).toLocaleTimeString()} · {cp.fileCount} 个文件
                    </div>
                  </div>
                  <button
                    onClick={() => void openCheckpointDiffTab(cp)}
                    title="查看与当前工作区的差异"
                    aria-label="查看与当前工作区的差异"
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700"
                  >
                    <Diff size={12} />
                  </button>
                  <button
                    onClick={() => confirm({
                      message: `确定回滚到检查点「${cp.label}」吗？工作区中相关文件将被覆盖，此操作不可撤销。`,
                      onConfirm: () => restoreCheckpoint.mutate(cp.id),
                    })}
                    disabled={restoreCheckpoint.isPending}
                    title="回滚到该检查点"
                    aria-label="回滚到该检查点"
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-700"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    onClick={() => confirm({
                      message: `确定删除检查点「${cp.label}」吗？删除后无法再回滚到该时间点。`,
                      onConfirm: () => deleteCheckpoint.mutate(cp.id),
                    })}
                    disabled={deleteCheckpoint.isPending}
                    title="删除检查点"
                    aria-label="删除检查点"
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-gray-700"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {cp.files.length > 0 && (
                  <div className="mt-0.5 truncate pl-5 font-mono text-[10px] text-gray-400">{cp.files.join(' · ')}</div>
                )}
              </div>
            ))}
          </div>
        ) : tab === 'git' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
              <GitBranch size={12} className="shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-600 dark:text-gray-300">
                {gitStatus?.isRepo ? gitStatus.branch : '非 Git 仓库'}
              </span>
              <button
                onClick={() => { setGitMessage(''); void refetchGit() }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]"
                title="刷新 Git 状态"
                aria-label="刷新 Git 状态"
              >
                <RefreshCw size={11} className={isGitLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {gitMessage && (
              <div className="mx-2 mt-1.5 rounded bg-sky-50 px-2 py-1 text-[10px] text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
                {gitMessage}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {!gitStatus?.isRepo && (
                <div className="px-2 py-8 text-center text-xs text-gray-400">当前项目目录不是 Git 仓库</div>
              )}
              {gitStatus?.isRepo && gitStatus.files.length === 0 && (
                <div className="px-2 py-8 text-center text-xs text-gray-400">工作区干净，没有未提交的变更</div>
              )}
              {gitStatus?.files.map((f) => {
                const meta = GIT_STATUS_META[f.status] ?? GIT_STATUS_META.M
                const checked = gitSelected.has(f.path)
                return (
                  <div key={f.path} className="mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setGitSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(f.path)) next.delete(f.path)
                        else next.add(f.path)
                        return next
                      })}
                      className="h-3.5 w-3.5 shrink-0"
                      aria-label={`选择 ${f.path}`}
                    />
                    <span
                      onClick={() => void openGitDiffTab(f)}
                      className="min-w-0 flex-1 cursor-pointer truncate font-mono text-[11px] text-gray-700 dark:text-gray-200"
                      title={`${f.path}（${meta.label}，点击查看差异）`}
                    >
                      {f.path}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${meta.cls}`}>{meta.label}</span>
                  </div>
                )
              })}
            </div>
            {gitSelected.size > 0 && (
              <div className="shrink-0 border-t border-gray-100 p-2 dark:border-gray-800">
                <input
                  value={gitCommitMessage}
                  onChange={(e) => setGitCommitMessage(e.target.value)}
                  placeholder="提交信息，如 fix: 修复登录样式"
                  className="mb-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
                />
                <button
                  onClick={() => confirm({
                    message: `确定提交选中的 ${gitSelected.size} 个文件吗？将执行 git add 并创建提交。`,
                    onConfirm: () => gitCommit.mutate(),
                  })}
                  disabled={!gitCommitMessage.trim() || gitCommit.isPending}
                  className="flex w-full items-center justify-center gap-1 rounded-lg bg-blue-500 py-1.5 text-[11px] font-medium text-white hover:bg-blue-600 disabled:opacity-40"
                >
                  {gitCommit.isPending ? <Loader2 size={11} className="animate-spin" /> : <GitCommitHorizontal size={11} />}
                  提交 {gitSelected.size} 个文件
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-1 border-b border-gray-100 p-1.5 dark:border-gray-800">
              <Search size={12} className="shrink-0 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchMode === 'semantic' ? '按语义检索代码（需已建索引）' : '搜索文件名或内容'}
                className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[11px] outline-none placeholder:text-gray-400"
              />
              <button
                onClick={() => setSearchMode(searchMode === 'text' ? 'semantic' : 'text')}
                title={searchMode === 'text' ? '切换为语义检索' : '切换为文本搜索'}
                className={`shrink-0 rounded p-0.5 ${searchMode === 'semantic' ? 'text-violet-500' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <Sparkles size={12} />
              </button>
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600">
                  <X size={11} />
                </button>
              )}
            </div>
            {searchTerm.length >= 2 ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {searchMode === 'text' ? (
                  <>
                    {isSearching && <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-gray-400" /></div>}
                    {!isSearching && searchHits.length === 0 && <div className="px-2 py-8 text-center text-xs text-gray-400">无匹配结果</div>}
                    {searchHits.map((hit, i) => (
                      <div
                        key={`${hit.path}:${hit.line}:${i}`}
                        onClick={() => openFileTab(hit.path, hit.path.split('/').pop() ?? hit.path)}
                        className="mb-0.5 cursor-pointer rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.04]"
                      >
                        <div className="truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">
                          {hit.path}{hit.line > 0 ? `:${hit.line}` : ''}
                        </div>
                        <div className="truncate text-[10px] text-gray-400">{hit.text}</div>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    {isCodeSearching && <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-gray-400" /></div>}
                    {!isCodeSearching && indexStatus && !indexStatus.isReady && (
                      <div className="px-2 py-8 text-center text-[11px] text-gray-400">
                        尚未建立代码向量索引，请先在项目设置中执行「重建代码索引」
                      </div>
                    )}
                    {!isCodeSearching && indexStatus?.isReady && codeHits.length === 0 && (
                      <div className="px-2 py-8 text-center text-xs text-gray-400">无匹配结果</div>
                    )}
                    {codeHits.map((hit: IWorkCodeSearchHit, i: number) => (
                      <div
                        key={`${hit.path}:${hit.startLine}:${i}`}
                        onClick={() => openFileTab(hit.path, hit.path.split('/').pop() ?? hit.path)}
                        className="mb-0.5 cursor-pointer rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.04]"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">
                            {hit.path}{hit.startLine > 0 ? `:${hit.startLine}` : ''}
                          </span>
                          <span className="shrink-0 text-[9px] text-violet-500">{hit.score.toFixed(3)}</span>
                        </div>
                        <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[10px] text-gray-400">{hit.snippet}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {rootQuery.isFetching && <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-gray-400" /></div>}
                {!rootQuery.isFetching && rootQuery.error && <div className="px-2 py-6 text-center text-xs text-red-500 dark:text-red-400">{rootQuery.error.message || '读取目录失败'}</div>}
                {!rootQuery.isFetching && !rootQuery.error && tree.length === 0 && <div className="py-8 text-center text-xs text-gray-400">空目录</div>}
                {tree.map((node) => renderNode(node, '', 0))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 右侧标签页内容区 */}
      <div className="flex min-w-0 flex-1 flex-col border-l border-gray-200 dark:border-gray-800">
        {tabs.length > 0 ? (
          <>
            <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-gray-100 bg-gray-50/60 px-1.5 dark:border-gray-800 dark:bg-gray-800/40">
              {tabs.map((t) => (
                <div
                  key={t.key}
                  onClick={() => setActiveKey(t.key)}
                  className={`group flex shrink-0 cursor-pointer items-center gap-1 rounded-t-md border border-b-0 px-2.5 py-1.5 text-[11px] transition-colors ${
                    activeKey === t.key
                      ? 'border-gray-200 bg-white font-medium text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-blue-300'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {t.kind === 'diff' ? <GitCompare size={11} className="text-indigo-400" /> : t.kind === 'checkpoint' ? <Diff size={11} className="text-sky-400" /> : <FileCode size={11} className="text-gray-400" />}
                  <span className="max-w-40 truncate">{t.label}</span>
                  {t.kind === 'file' && drafts.has(t.key) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="未保存" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(t.key) }}
                    className="ml-0.5 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-600 group-hover:opacity-100 dark:hover:bg-gray-700"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>

            <div className="min-h-0 flex-1">
              {actionError && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 bg-red-50 px-3 py-1 text-[11px] text-red-600 dark:border-gray-800 dark:bg-red-950/30 dark:text-red-400">
                  <span className="min-w-0 flex-1">{actionError}</span>
                  <button onClick={() => setActionError('')} className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40" aria-label="关闭错误提示">
                    <X size={10} />
                  </button>
                </div>
              )}
              {saveMessage && (
                <div className="shrink-0 border-b border-gray-100 bg-gray-50/60 px-3 py-1 text-[11px] text-gray-500 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400">
                  {saveMessage}
                </div>
              )}
              {activeTab?.kind === 'diff' && activeTab.change && (
                <WorkDiffView
                  change={activeTab.change}
                  actionPending={writeFileContent.isPending}
                  revertLabel={activeTab.change.id.startsWith('git:') ? '还原到 HEAD 版本' : '还原到编辑前'}
                  onRevert={() => handleRevertChange(activeTab.change!, activeTab.change!.id.startsWith('git:') ? '还原到 HEAD 版本' : '还原到编辑前')}
                  onApply={activeTab.change.id.startsWith('git:') ? undefined : () => handleApplyChange(activeTab.change!)}
                />
              )}
              {activeTab?.kind === 'checkpoint' && activeTab.checkpoint && (
                <WorkCheckpointDiffView
                  diff={activeTab.checkpoint}
                  actionPending={writeFileContent.isPending}
                  onRevertFile={(path, oldContent) => confirm({
                    message: `确定把 ${path} 还原到快照版本吗？磁盘上的当前内容将被覆盖。`,
                    onConfirm: () => writeFileContent.mutate({ path, content: oldContent }),
                  })}
                />
              )}
              {activeTab?.kind === 'file' && activeTab.file && (
                activeTab.file.isBinary ? (
                  <div className="flex h-full items-center justify-center p-4 text-xs text-gray-400">二进制文件（{activeTab.file.size} bytes）</div>
                ) : (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-1 dark:border-gray-800">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-400">{activeTab.file.path}</span>
                      <button
                        onClick={quoteSelection}
                        title="将选中代码加入对话（Quote）"
                        className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                      >
                        <Quote size={11} />引用选中
                      </button>
                      <button
                        onClick={saveActiveTab}
                        disabled={!drafts.has(activeTab.key) || saveFile.isPending}
                        className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/40"
                        title="保存（Ctrl+S）"
                      >
                        {saveFile.isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                        保存
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <CodeMirror
                        value={draftOf(activeTab)}
                        height="100%"
                        theme={isDark ? 'dark' : 'light'}
                        onCreateEditor={(view) => { editorViewRef.current = view }}
                        onChange={(value) =>
                          setDrafts((prev) => {
                            const next = new Map(prev)
                            if (value === activeTab.file?.content) next.delete(activeTab.key)
                            else next.set(activeTab.key, value)
                            return next
                          })
                        }
                        extensions={[
                          editorBaseTheme,
                          EditorView.lineWrapping,
                          keymap.of([...searchKeymap]),
                          search({ top: true }),
                          ...(langFor(activeTab.file.name) ? [langFor(activeTab.file.name)!] : []),
                        ]}
                        basicSetup={{
                          lineNumbers: true,
                          foldGutter: true,
                          highlightActiveLine: false,
                          highlightActiveLineGutter: false,
                        }}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col">
            {actionError && (
              <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
                <span className="min-w-0 flex-1">{actionError}</span>
                <button onClick={() => setActionError('')} className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40" aria-label="关闭错误提示">
                  <X size={10} />
                </button>
              </div>
            )}
            <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
              点击文件或更改在标签页中打开
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

