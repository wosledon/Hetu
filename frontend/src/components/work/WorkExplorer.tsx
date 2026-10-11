import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, Loader2, X, Globe, GitCompare, GitBranch, GitCommitHorizontal, FileCode, History, RotateCcw, Search, Save, Sparkles, Diff, Trash2, Quote, LayoutGrid, TerminalSquare, ArrowLeft, ArrowRight, ExternalLink, Home } from 'lucide-react'
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
import WorkTerminal from './WorkTerminal'

interface WorkExplorerProps {
  projectId?: string
  sessionId?: string
  /** 当前打开的文件路径变化（供对话区显示引用 chip） */
  onActiveFileChange?: (path: string | null) => void
  /** 打开指定文件请求（来自对话区点击路径） */
  openFileRequest?: { path: string; nonce: number } | null
  /** 把编辑器选中代码加入对话上下文 */
  onAddSelectionContext?: (path: string, text: string) => void
  /** 在编辑器当前标签光标处插入文本（来自对话代码块动作） */
  insertRequest?: { text: string; path?: string; nonce: number } | null
  /** 外部注入的终端命令请求（对话区"在终端运行"） */
  commandRequest?: { command: string; nonce: number } | null
}

interface TreeNode extends IWorkFileEntry {
  children?: TreeNode[]
  loaded?: boolean
}

type FeatureKind = 'guide' | 'files' | 'changes' | 'checkpoints' | 'browser' | 'git' | 'terminal'

interface FeatureTab { key: FeatureKind; label: string }

const FEATURE_LABEL_KEYS: Record<FeatureKind, string> = {
  guide: 'explorer.tabs.guide',
  files: 'explorer.tabs.files',
  changes: 'explorer.tabs.changes',
  checkpoints: 'explorer.tabs.checkpoints',
  browser: 'explorer.tabs.browser',
  git: 'explorer.tabs.git',
  terminal: 'explorer.tabs.terminal',
}

const GIT_STATUS_META: Record<string, { labelKey: string; cls: string }> = {
  M: { labelKey: 'explorer.gitStatus.modify', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  A: { labelKey: 'explorer.gitStatus.add', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  D: { labelKey: 'explorer.gitStatus.delete', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  R: { labelKey: 'explorer.gitStatus.rename', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  '??': { labelKey: 'explorer.gitStatus.untracked', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
}

interface OpenTab {
  key: string
  label: string
  kind: 'file' | 'diff' | 'checkpoint'
  file?: IWorkFileContent
  change?: IWorkFileChange
  checkpoint?: IWorkCheckpointDiff
}

export default function WorkExplorer({ projectId, sessionId, onActiveFileChange, openFileRequest, onAddSelectionContext, insertRequest, commandRequest }: WorkExplorerProps) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loadedDirs, setLoadedDirs] = useState<Map<string, TreeNode[]>>(new Map())
  const [browserUrl, setBrowserUrl] = useState('')
  const [tabs, setTabs] = useState<OpenTab[]>([])
  // 面板活动视图：功能标签页（guide/files/...）或文档标签页（file/diff/checkpoint）
  const [activePanel, setActivePanel] = useState<{ type: 'feature' | 'doc'; key: string }>({ type: 'feature', key: 'guide' })
  const [featureTabs, setFeatureTabs] = useState<FeatureTab[]>([{ key: 'guide', label: t(FEATURE_LABEL_KEYS.guide) }])
  const activeFeature: FeatureKind | null = activePanel.type === 'feature' ? (activePanel.key as FeatureKind) : null

  /** 打开/激活一个功能标签页（文件/更改/检查点/Git/浏览器/终端） */
  const activateFeature = (key: FeatureKind) => {
    setFeatureTabs((prev) => (prev.some((tab) => tab.key === key) ? prev : [...prev, { key, label: t(FEATURE_LABEL_KEYS[key]) }]))
    setActivePanel({ type: 'feature', key })
  }

  /** 关闭功能标签页；关闭后回到新标签页 */
  const closeFeature = (key: FeatureKind) => {
    setFeatureTabs((prev) => {
      const next = prev.filter((tab) => tab.key !== key)
      if (activePanel.type === 'feature' && activePanel.key === key) {
        setActivePanel({ type: 'feature', key: next.some((tab) => tab.key === 'guide') ? 'guide' : (next[0]?.key ?? 'guide') })
        if (!next.some((tab) => tab.key === 'guide')) return [{ key: 'guide', label: t(FEATURE_LABEL_KEYS.guide) }, ...next.filter((tab) => tab.key !== 'guide')]
      }
      return next
    })
  }

  /** 激活一个已打开的文档标签页 */
  const openDoc = (key: string) => {
    setActivePanel({ type: 'doc', key })
  }
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'text' | 'semantic'>('text')
  const [restoreMessage, setRestoreMessage] = useState('')
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map())
  const [saveMessage, setSaveMessage] = useState('')
  const [actionError, setActionError] = useState('')
  // 功能列表与文档区的可分栏宽度 + 标签页右键菜单
  const [listWidth, setListWidth] = useState(256)
  const listDragging = useRef<{ startX: number; startWidth: number } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; kind: 'feature' | 'doc'; key: string; label: string } | null>(null)

  const { data: changes = [] } = useQuery({
    queryKey: ['workFileChanges', sessionId],
    queryFn: () => (sessionId ? workSessionService.getFileChanges(sessionId) : Promise.resolve([])),
    enabled: !!sessionId,
    // 文件改动后无需手动刷新，轮询保持列表最新
    refetchInterval: sessionId ? 5000 : false,
  })

  const { data: checkpoints = [] } = useQuery({
    queryKey: ['workCheckpoints', sessionId],
    queryFn: () => (sessionId ? workSessionService.getCheckpoints(sessionId) : Promise.resolve([])),
    enabled: !!sessionId,
  })

  const { data: gitStatus, refetch: refetchGit, isFetching: isGitLoading } = useQuery({
    queryKey: ['workGitStatus', projectId, sessionId],
    queryFn: () => workGitService.status(projectId!, sessionId),
    enabled: !!projectId && activeFeature === 'git',
    refetchInterval: !!projectId && activeFeature === 'git' ? 5000 : false,
  })
  const [gitSelected, setGitSelected] = useState<Set<string>>(new Set())
  const [gitCommitMessage, setGitCommitMessage] = useState('')
  const [gitMessage, setGitMessage] = useState('')

  const gitCommit = useMutation({
    mutationFn: () => workGitService.commit(projectId!, gitCommitMessage.trim(), [...gitSelected], sessionId),
    onSuccess: (result) => {
      setGitMessage(result.output || t('explorer.committed'))
      setGitCommitMessage('')
      setGitSelected(new Set())
      void refetchGit()
    },
    onError: (e: Error) => setGitMessage(t('explorer.commitFailed', { error: e.message })),
  })

  const searchTerm = searchQuery.trim()

  const { data: searchHits = [], isFetching: isSearching } = useQuery({
    queryKey: ['workFileSearch', projectId, searchTerm],
    queryFn: () => workFileService.search(projectId!, searchTerm, 80, sessionId),
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
      workFileService.write(projectId!, payload.path, payload.content, payload.originalContent, sessionId),
    onSuccess: (saved, payload) => {
      setTabs((prev) => prev.map((t) => (t.key === payload.key && t.file ? { ...t, file: saved } : t)))
      setDrafts((prev) => {
        const next = new Map(prev)
        next.delete(payload.key)
        return next
      })
      setSaveMessage(t('explorer.savedFile', { path: payload.path }))
      setTimeout(() => setSaveMessage(''), 2500)
      queryClient.invalidateQueries({ queryKey: ['workDirEntries', projectId] })
    },
    onError: (error: Error) => setSaveMessage(t('explorer.saveFailed', { error: error.message })),
  })

  const restoreCheckpoint = useMutation({
    mutationFn: (id: string) => workCheckpointService.restore(id),
    onSuccess: (result) => {
      setRestoreMessage(
        t('explorer.restored', { restored: result.restoredCount, deleted: result.deletedCount }) +
          (result.errors.length > 0 ? t('explorer.restoredWithErrors', { count: result.errors.length }) : ''),
      )
      queryClient.invalidateQueries({ queryKey: ['workFileChanges', sessionId] })
      if (projectId) queryClient.invalidateQueries({ queryKey: ['workDirEntries', projectId] })
    },
    onError: (e: Error) => setRestoreMessage(t('explorer.rollbackFailed', { error: e.message })),
  })

  /** diff 还原/应用：把指定版本内容写回工作区（不传 originalContent，跳过冲突校验） */
  const writeFileContent = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      workFileService.write(projectId!, path, content, undefined, sessionId),
    onSuccess: (_r, { path }) => {
      setSaveMessage(t('explorer.written', { path }))
      setTimeout(() => setSaveMessage(''), 2500)
      if (projectId) queryClient.invalidateQueries({ queryKey: ['workDirEntries', projectId] })
      queryClient.invalidateQueries({ queryKey: ['workFileChanges', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['workGitStatus', projectId] })
    },
    onError: (e: Error) => setSaveMessage(t('explorer.writeFailed', { error: e.message })),
  })

  const handleRevertChange = (change: IWorkFileChange, target: 'head' | 'edit') => {
    confirm({
      message: t(target === 'head' ? 'explorer.revertConfirmHead' : 'explorer.revertConfirmEdit', { path: change.filePath }),
      onConfirm: () => writeFileContent.mutate({ path: change.filePath, content: change.oldContent ?? '' }),
    })
  }

  const handleApplyChange = (change: IWorkFileChange) => {
    confirm({
      message: t('explorer.applyConfirm', { path: change.filePath }),
      onConfirm: () => writeFileContent.mutate({ path: change.filePath, content: change.newContent }),
    })
  }

  const deleteCheckpoint = useMutation({
    mutationFn: workCheckpointService.delete,
    onSuccess: (_result, checkpointId) => {
      setRestoreMessage(t('explorer.checkpointDeleted'))
      queryClient.invalidateQueries({ queryKey: ['workCheckpoints', sessionId] })
      setTabs((prev) => prev.filter((tab) => tab.key !== `cp:${checkpointId}`))
    },
    onError: (e: Error) => setRestoreMessage(t('explorer.deleteCheckpointFailed', { error: e.message })),
  })

  const loadDir = useCallback(async (path: string) => {
    if (!projectId) return []
    const entries = await workFileService.list(projectId, path || undefined, sessionId)
    return entries
  }, [projectId])

  const rootQuery = useQuery({
    queryKey: ['workDirEntries', projectId, ''],
    queryFn: () => loadDir(''),
    enabled: !!projectId,
    // 外部（AI 工具/终端）修改文件后轮询刷新目录列表
    refetchInterval: projectId ? 5000 : false,
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
      openDoc(key)
      setSelectedPath(nodePath)
      return
    }
    try {
      const content = await workFileService.read(projectId, nodePath, sessionId)
      const newTab: OpenTab = { key, label: name, kind: 'file', file: content }
      setTabs((prev) => [...prev, newTab])
      openDoc(key)
      setSelectedPath(nodePath)
      setActionError('')

      onActiveFileChange?.(nodePath)
    } catch (e) {
      setActionError(t('explorer.openFileFailed', { error: (e as Error).message || t('explorer.unknownError') }))
    }
  }

  const openDiffTab = (change: IWorkFileChange) => {
    const key = `diff:${change.id}`
    if (tabs.some((t) => t.key === key)) {
      openDoc(key)
      return
    }
    const name = change.filePath.split('/').pop() ?? change.filePath
    setTabs((prev) => [...prev, { key, label: `${name} (diff)`, kind: 'diff', change }])
    openDoc(key)
  }

  const openCheckpointDiffTab = async (cp: IWorkCheckpoint) => {
    const key = `cp:${cp.id}`
    if (tabs.some((t) => t.key === key)) {
      openDoc(key)
      return
    }
    try {
      const diff = await workCheckpointService.diff(cp.id)
      setTabs((prev) => [...prev, { key, label: `${cp.label} (${t('explorer.diffSuffix')})`, kind: 'checkpoint', checkpoint: diff }])
      openDoc(key)
    } catch { setRestoreMessage(t('explorer.readCheckpointDiffFailed')) }
  }

  /** 打开 Git 工作区差异：旧内容取 HEAD 版本，新内容取磁盘当前文件 */
  const openGitDiffTab = async (file: { path: string; status: string }) => {
    if (!projectId) return
    const key = `diff:git:${file.path}`
    if (tabs.some((t) => t.key === key)) {
      openDoc(key)
      return
    }
    try {
      const content = await workGitService.fileContent(projectId, file.path, sessionId)
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
      openDoc(key)
    } catch (e) {
      setActionError(t('explorer.readGitDiffFailed', { error: (e as Error).message || t('explorer.unknownError') }))
    }
  }

  const draftOf = (tab: OpenTab) => drafts.get(tab.key) ?? tab.file?.content ?? ''

  const activeDoc = activePanel.type === 'doc' ? tabs.find((t) => t.key === activePanel.key) : undefined

  const saveactiveDoc = useCallback(() => {
    if (!activeDoc || activeDoc.kind !== 'file' || !activeDoc.file || !projectId) return
    const content = drafts.get(activeDoc.key)
    if (content === undefined) return
    saveFile.mutate({
      key: activeDoc.key,
      path: activeDoc.file.path,
      content,
      originalContent: activeDoc.file.content ?? '',
    })
  }, [activeDoc, drafts, projectId, saveFile])

  // Ctrl/Cmd+S 保存当前文件：经 ref 调用最新回调，监听器只注册一次
  const saveactiveDocRef = useRef<() => void>(() => {})
  useEffect(() => { saveactiveDocRef.current = saveactiveDoc }, [saveactiveDoc])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      saveactiveDocRef.current()
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
    if (activePanel.type !== 'doc' || !activeDoc?.file) onActiveFileChange?.(null)
  }, [activePanel, activeDoc, onActiveFileChange])

  // 对话代码块"插入到编辑器"
  const editorViewRef = useRef<EditorView | null>(null)
  const pendingInsertRef = useRef<string | null>(null)
  const insertAtCursor = (text: string) => {
    const view = editorViewRef.current
    if (!view || !activeDoc || activeDoc.kind !== 'file' || !activeDoc.file) return
    const { from } = view.state.selection.main
    const current = draftOf(activeDoc)
    const next = current.slice(0, from) + text + current.slice(from)
    setDrafts((prev) => new Map(prev).set(activeDoc.key, next))
    setSaveMessage(t('explorer.insertedToEditor'))
    setTimeout(() => setSaveMessage(''), 2000)
  }
  const lastInsertNonce = useRef(0)
  /* 以下两个 effect 是"外部事件 → 状态同步"的指令式通道（对话代码块插入编辑器），
     不是渲染派生副作用，故按设计关闭 set-state-in-effect / exhaustive-deps 检查 */
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!insertRequest || insertRequest.nonce === lastInsertNonce.current) return
    lastInsertNonce.current = insertRequest.nonce
    if (insertRequest.path && insertRequest.path !== activeDoc?.file?.path) {
      // 目标文件未打开：先打开再插入
      pendingInsertRef.current = insertRequest.text
      const name = insertRequest.path.split('/').pop() ?? insertRequest.path
      void openFileTab(insertRequest.path, name)
      return
    }
    insertAtCursor(insertRequest.text)
  }, [insertRequest])
  useEffect(() => {
    if (!pendingInsertRef.current || !activeDoc || activeDoc.kind !== 'file') return
    const text = pendingInsertRef.current
    pendingInsertRef.current = null
    insertAtCursor(text)
  }, [activeDoc?.key])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const quoteSelection = () => {
    const view = editorViewRef.current
    if (!view || !activeDoc || activeDoc.kind !== 'file' || !activeDoc.file) return
    const { from, to } = view.state.selection.main
    if (from === to) {
      setSaveMessage(t('explorer.selectCodeFirst'))
      setTimeout(() => setSaveMessage(''), 2000)
      return
    }
    const text = view.state.sliceDoc(from, to)
    if (text.length > 8000) {
      setSaveMessage(t('explorer.selectionTooLarge'))
      setTimeout(() => setSaveMessage(''), 2000)
      return
    }
    onAddSelectionContext?.(activeDoc.file.path, text)
    setSaveMessage(t('explorer.addedToContext'))
    setTimeout(() => setSaveMessage(''), 2000)
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
        setActionError(t('explorer.readDirFailed', { error: (e as Error).message || t('explorer.unknownError') }))
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

  const NAV_ITEMS: { key: FeatureKind; label: string; desc: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { key: 'files', label: t('explorer.tabs.files'), desc: t('explorer.nav.filesDesc'), Icon: Folder },
    { key: 'changes', label: t('explorer.tabs.changes'), desc: t('explorer.nav.changesDesc'), Icon: GitCompare },
    { key: 'checkpoints', label: t('explorer.tabs.checkpoints'), desc: t('explorer.nav.checkpointsDesc'), Icon: History },
    { key: 'git', label: t('explorer.tabs.git'), desc: t('explorer.nav.gitDesc'), Icon: GitBranch },
    { key: 'browser', label: t('explorer.tabs.browser'), desc: t('explorer.nav.browserDesc'), Icon: Globe },
    { key: 'terminal', label: t('explorer.tabs.terminal'), desc: t('explorer.nav.terminalDesc'), Icon: TerminalSquare },
  ]

  const features = NAV_ITEMS

  const openTabMenu = (e: React.MouseEvent, kind: 'feature' | 'doc', key: string, label: string) => {
    e.preventDefault()
    e.stopPropagation()
    setTabMenu({ x: e.clientX, y: e.clientY, kind, key, label })
  }

  const docTab = (tab: OpenTab) => {
    const active = activePanel.type === 'doc' && activePanel.key === tab.key
    return (
      <div
        key={tab.key}
        onClick={() => openDoc(tab.key)}
        onContextMenu={(e) => openTabMenu(e, 'doc', tab.key, tab.label)}
        className={`group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg px-2.5 text-[11px] font-medium transition-colors ${
          active ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.04]'
        }`}
      >
        <FileCode size={11} className="shrink-0" />
        <span className="max-w-[110px] truncate">{tab.label}</span>
        {tab.kind === 'file' && drafts.has(tab.key) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title={t('common:unsaved')} />}
        <span
          onClick={(e) => { e.stopPropagation(); closeDocTab(tab.key) }}
          role="button"
          aria-label={t('explorer.closeTab')}
          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
        >
          <X size={9} />
        </span>
      </div>
    )
  }

  const closeDocTab = (key: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key)
      const next = prev.filter((t) => t.key !== key)
      if (activePanel.type === 'doc' && activePanel.key === key) {
        const neighbor = prev[idx + 1] ?? prev[idx - 1]
        if (neighbor) openDoc(neighbor.key)
        else setActivePanel({ type: 'feature', key: 'guide' })
      }
      return next
    })
  }

  const closeOtherDocTabs = (key: string) => {
    setTabs((prev) => prev.filter((t) => t.key === key))
    setActivePanel({ type: 'doc', key })
  }

  const closeAllDocTabs = () => {
    setTabs([])
    setActivePanel({ type: 'feature', key: 'guide' })
  }

  // 标签页右键菜单：点击别处或按 Esc 关闭
  useEffect(() => {
    if (!tabMenu) return
    const close = () => setTabMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [tabMenu])

  // 功能列表与文档区之间的拖拽分栏
  const onListDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    listDragging.current = { startX: e.clientX, startWidth: listWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [listWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = listDragging.current
      if (!d) return
      setListWidth(Math.min(520, Math.max(200, d.startWidth + (e.clientX - d.startX))))
    }
    const onUp = () => {
      listDragging.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <>
    <div className="flex min-w-0 flex-1 border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* 左侧垂直导航 */}
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-gray-100 py-2 dark:border-gray-800">
        {NAV_ITEMS.map((n) => {
          const Icon = n.Icon
          const active = activeFeature === n.key
          return (
            <button
              key={n.key}
              onClick={() => activateFeature(n.key)}
              title={n.label}
              disabled={!projectId}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
                active
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
              }`}
            >
              <Icon size={15} />
            </button>
          )
        })}
        <div className="flex-1" />
        <button onClick={() => { setLoadedDirs(new Map()); setExpanded(new Set()); void rootQuery.refetch() }} title={t('common:refresh')} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 主区：浏览器风格标签条 + 内容 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-gray-100 px-1.5 dark:border-gray-800">
          {featureTabs.map((tab) => {
            const nav = NAV_ITEMS.find((n) => n.key === tab.key)
            const Icon = tab.key === 'guide' ? LayoutGrid : (nav?.Icon ?? Folder)
            const active = activePanel.type === 'feature' && activePanel.key === tab.key
            return (
              <div
                key={tab.key}
                onClick={() => setActivePanel({ type: 'feature', key: tab.key })}
                onContextMenu={(e) => openTabMenu(e, 'feature', tab.key, tab.label)}
                className={`group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg px-2.5 text-[11px] font-medium transition-colors ${
                  active ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.04]'
                }`}
              >
                <Icon size={11} className="shrink-0" />
                <span className="max-w-[100px] truncate">{tab.label}</span>
                <span
                  onClick={(e) => { e.stopPropagation(); closeFeature(tab.key) }}
                  role="button"
                  aria-label={t('explorer.closeTab')}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
                >
                  <X size={9} />
                </span>
              </div>
            )
          })}
          {tabs.map(docTab)}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {activeFeature === 'guide' ? (
            /* 新标签页：居中垂直功能导航 */
            <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
              <div className="w-full max-w-xs">
                <div className="mb-5 text-center">
                  <LayoutGrid size={26} className="mx-auto mb-2.5 text-blue-500" />
                  <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('explorer.workbench')}</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
                    {projectId ? t('explorer.workbenchHint') : t('selectProjectFirst')}
                  </p>
                </div>
                <div className="space-y-0.5">
                  {features.map((f) => {
                    const Icon = f.Icon
                    return (
                      <button
                        key={f.key}
                        onClick={() => activateFeature(f.key)}
                        disabled={!projectId}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06]"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-500 dark:bg-blue-950/40 dark:text-blue-400">
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-gray-800 dark:text-gray-100">{f.label}</span>
                          <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">{f.desc}</span>
                        </span>
                        <ChevronRight size={13} className="shrink-0 text-gray-300 dark:text-gray-600" />
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : activeFeature === 'terminal' ? (
            <WorkTerminal projectId={projectId} sessionId={sessionId} commandRequest={commandRequest} />
          ) : activeFeature === 'browser' ? (
            <BrowserPanel url={browserUrl} onUrlChange={setBrowserUrl} />
          ) : (
      <div className="flex min-w-0 flex-1">
      {/* 左侧栏：当前功能的列表/树，宽度可拖拽调整 */}
      <div className="flex shrink-0 flex-col" style={{ width: listWidth }}>
        {activeFeature === 'changes' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {changes.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-gray-400">{t('explorer.noFileChanges')}</div>
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
                    {change.action === 'create' ? t('checkpointDiff.actionCreate') : change.action === 'delete' ? t('checkpointDiff.actionDelete') : t('explorer.gitStatus.modify')}
                  </span>
                </div>
              )
            })}
          </div>
        ) : activeFeature === 'checkpoints' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {restoreMessage && (
              <div className="mb-1.5 rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
                {restoreMessage}
              </div>
            )}
            {!sessionId && (
              <div className="px-2 py-8 text-center text-xs text-gray-400">{t('explorer.pickSessionForCheckpoints')}</div>
            )}
            {sessionId && checkpoints.length === 0 && (
              <div className="px-2 py-8 text-center text-xs text-gray-400">{t('explorer.noCheckpoints')}</div>
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
                      {new Date(cp.createdAt).toLocaleTimeString()} · {t('explorer.fileCount', { count: cp.fileCount })}
                    </div>
                  </div>
                  <button
                    onClick={() => void openCheckpointDiffTab(cp)}
                    title={t('explorer.viewWorkspaceDiff')}
                    aria-label={t('explorer.viewWorkspaceDiff')}
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700"
                  >
                    <Diff size={12} />
                  </button>
                  <button
                    onClick={() => confirm({
                      message: t('explorer.rollbackCheckpointConfirm', { label: cp.label }),
                      onConfirm: () => restoreCheckpoint.mutate(cp.id),
                    })}
                    disabled={restoreCheckpoint.isPending}
                    title={t('explorer.rollbackToCheckpoint')}
                    aria-label={t('explorer.rollbackToCheckpoint')}
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-700"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    onClick={() => confirm({
                      message: t('explorer.deleteCheckpointConfirm', { label: cp.label }),
                      onConfirm: () => deleteCheckpoint.mutate(cp.id),
                    })}
                    disabled={deleteCheckpoint.isPending}
                    title={t('explorer.deleteCheckpoint')}
                    aria-label={t('explorer.deleteCheckpoint')}
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
        ) : activeFeature === 'git' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
              <GitBranch size={12} className="shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-600 dark:text-gray-300">
                {gitStatus?.isRepo ? gitStatus.branch : t('explorer.notGitRepo')}
              </span>
              <button
                onClick={() => { setGitMessage(''); void refetchGit() }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]"
                title={t('explorer.refreshGitStatus')}
                aria-label={t('explorer.refreshGitStatus')}
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
                <div className="px-2 py-8 text-center text-xs text-gray-400">{t('explorer.dirNotGitRepo')}</div>
              )}
              {gitStatus?.isRepo && gitStatus.files.length === 0 && (
                <div className="px-2 py-8 text-center text-xs text-gray-400">{t('explorer.cleanWorkspace')}</div>
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
                      aria-label={t('explorer.selectFile', { path: f.path })}
                    />
                    <span
                      onClick={() => void openGitDiffTab(f)}
                      className="min-w-0 flex-1 cursor-pointer truncate font-mono text-[11px] text-gray-700 dark:text-gray-200"
                      title={t('explorer.fileDiffTitle', { path: f.path, label: t(meta.labelKey) })}
                    >
                      {f.path}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${meta.cls}`}>{t(meta.labelKey)}</span>
                  </div>
                )
              })}
            </div>
            {gitSelected.size > 0 && (
              <div className="shrink-0 border-t border-gray-100 p-2 dark:border-gray-800">
                <input
                  value={gitCommitMessage}
                  onChange={(e) => setGitCommitMessage(e.target.value)}
                  placeholder={t('explorer.commitMessagePlaceholder')}
                  className="mb-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] outline-none focus:border-blue-300 dark:border-gray-700 dark:bg-gray-800"
                />
                <button
                  onClick={() => confirm({
                    message: t('explorer.commitConfirm', { count: gitSelected.size }),
                    onConfirm: () => gitCommit.mutate(),
                  })}
                  disabled={!gitCommitMessage.trim() || gitCommit.isPending}
                  className="flex w-full items-center justify-center gap-1 rounded-lg bg-blue-500 py-1.5 text-[11px] font-medium text-white hover:bg-blue-600 disabled:opacity-40"
                >
                  {gitCommit.isPending ? <Loader2 size={11} className="animate-spin" /> : <GitCommitHorizontal size={11} />}
                  {t('explorer.commitSelected', { count: gitSelected.size })}
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
                placeholder={searchMode === 'semantic' ? t('explorer.searchSemanticPlaceholder') : t('explorer.searchTextPlaceholder')}
                className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[11px] outline-none placeholder:text-gray-400"
              />
              <button
                onClick={() => setSearchMode(searchMode === 'text' ? 'semantic' : 'text')}
                title={searchMode === 'text' ? t('explorer.switchToSemantic') : t('explorer.switchToText')}
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
                    {!isSearching && searchHits.length === 0 && <div className="px-2 py-8 text-center text-xs text-gray-400">{t('explorer.noMatches')}</div>}
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
                        {t('explorer.noIndex')}
                      </div>
                    )}
                    {!isCodeSearching && indexStatus?.isReady && codeHits.length === 0 && (
                      <div className="px-2 py-8 text-center text-xs text-gray-400">{t('explorer.noMatches')}</div>
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
                {!rootQuery.isFetching && rootQuery.error && <div className="px-2 py-6 text-center text-xs text-red-500 dark:text-red-400">{rootQuery.error.message || t('explorer.readDirFailedShort')}</div>}
                {!rootQuery.isFetching && !rootQuery.error && tree.length === 0 && <div className="py-8 text-center text-xs text-gray-400">{t('explorer.emptyDir')}</div>}
                {tree.map((node) => renderNode(node, '', 0))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 分栏拖拽手柄：视觉上只有 1px，命中区域 7px */}
      <div
        onMouseDown={onListDragStart}
        className="group relative w-px shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-blue-400 dark:bg-gray-800 dark:hover:bg-blue-500"
        title={t('explorer.dragWidth')}
      >
        <span className="absolute inset-y-0 -left-[3px] w-[7px]" />
      </div>

      {/* 右侧标签页内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {activeDoc ? (
            <div className="min-h-0 flex-1">
              {actionError && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 bg-red-50 px-3 py-1 text-[11px] text-red-600 dark:border-gray-800 dark:bg-red-950/30 dark:text-red-400">
                  <span className="min-w-0 flex-1">{actionError}</span>
                  <button onClick={() => setActionError('')} className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40" aria-label={t('explorer.closeError')}>
                    <X size={10} />
                  </button>
                </div>
              )}
              {saveMessage && (
                <div className="shrink-0 border-b border-gray-100 bg-gray-50/60 px-3 py-1 text-[11px] text-gray-500 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400">
                  {saveMessage}
                </div>
              )}
              {activeDoc?.kind === 'diff' && activeDoc.change && (
                <WorkDiffView
                  change={activeDoc.change}
                  actionPending={writeFileContent.isPending}
                  revertLabel={activeDoc.change.id.startsWith('git:') ? t('explorer.revertToHead') : t('explorer.revertToBeforeEdit')}
                  onRevert={() => handleRevertChange(activeDoc.change!, activeDoc.change!.id.startsWith('git:') ? 'head' : 'edit')}
                  onApply={activeDoc.change.id.startsWith('git:') ? undefined : () => handleApplyChange(activeDoc.change!)}
                />
              )}
              {activeDoc?.kind === 'checkpoint' && activeDoc.checkpoint && (
                <WorkCheckpointDiffView
                  diff={activeDoc.checkpoint}
                  actionPending={writeFileContent.isPending}
                  onRevertFile={(path, oldContent) => confirm({
                    message: t('explorer.revertSnapshotConfirm', { path }),
                    onConfirm: () => writeFileContent.mutate({ path, content: oldContent }),
                  })}
                />
              )}
              {activeDoc?.kind === 'file' && activeDoc.file && (
                activeDoc.file.isBinary ? (
                  <div className="flex h-full items-center justify-center p-4 text-xs text-gray-400">{t('explorer.binaryFile', { size: activeDoc.file.size })}</div>
                ) : (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-1 dark:border-gray-800">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-400">{activeDoc.file.path}</span>
                      <button
                        onClick={quoteSelection}
                        title={t('explorer.quoteSelection')}
                        className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                      >
                        <Quote size={11} />{t('explorer.quoteSelected')}
                      </button>
                      <button
                        onClick={saveactiveDoc}
                        disabled={!drafts.has(activeDoc.key) || saveFile.isPending}
                        className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/40"
                        title={t('explorer.saveShortcut')}
                      >
                        {saveFile.isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                        {t('common:save')}
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <CodeMirror
                        value={draftOf(activeDoc)}
                        height="100%"
                        theme={isDark ? 'dark' : 'light'}
                        onCreateEditor={(view) => { editorViewRef.current = view }}
                        onChange={(value) =>
                          setDrafts((prev) => {
                            const next = new Map(prev)
                            if (value === activeDoc.file?.content) next.delete(activeDoc.key)
                            else next.set(activeDoc.key, value)
                            return next
                          })
                        }
                        extensions={[
                          editorBaseTheme,
                          EditorView.lineWrapping,
                          keymap.of([...searchKeymap]),
                          search({ top: true }),
                          ...(langFor(activeDoc.file.name) ? [langFor(activeDoc.file.name)!] : []),
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
        ) : (
          <div className="flex flex-1 flex-col">
            {actionError && (
              <div className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
                <span className="min-w-0 flex-1">{actionError}</span>
                <button onClick={() => setActionError('')} className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40" aria-label={t('explorer.closeError')}>
                  <X size={10} />
                </button>
              </div>
            )}
            <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
              {activeFeature === 'files' ? t('explorer.clickFileToOpen') : activeFeature === 'changes' ? t('explorer.clickChangeToViewDiff') : activeFeature === 'checkpoints' ? t('explorer.clickCheckpointToViewDiff') : t('explorer.featureContent')}
            </div>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
    </div>
  </div>

  {/* 标签页右键菜单 */}
  {tabMenu && (
    <div
      className="fixed z-50 min-w-[128px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      style={{ left: tabMenu.x, top: tabMenu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          if (tabMenu.kind === 'feature') closeFeature(tabMenu.key as FeatureKind)
          else closeDocTab(tabMenu.key)
          setTabMenu(null)
        }}
        className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {t('common:close')}
      </button>
      <button
        onClick={() => {
          if (tabMenu.kind === 'feature') closeFeature(tabMenu.key as FeatureKind)
          else closeOtherDocTabs(tabMenu.key)
          setTabMenu(null)
        }}
        className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {t('explorer.closeOthers')}
      </button>
      <button
        onClick={() => {
          if (tabMenu.kind === 'feature') closeFeature(tabMenu.key as FeatureKind)
          else closeAllDocTabs()
          setTabMenu(null)
        }}
        className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {t('explorer.closeAll')}
      </button>
    </div>
  )}
    </>
  )
}

/* ─── 内嵌浏览器面板 ─── */

/** 带导航工具条的内嵌浏览器：历史前进后退、刷新、外站新窗打开、常用链接 */
function BrowserPanel({ url, onUrlChange }: { url: string; onUrlChange: (u: string) => void }) {
  const { t } = useTranslation('work')
  const [input, setInput] = useState(url)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [frameKey, setFrameKey] = useState(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { setInput(url) }, [url])

  const navigate = (target: string, push = true) => {
    const normalized = /^https?:\/\//i.test(target) ? target : `https://${target}`
    onUrlChange(normalized)
    setInput(normalized)
    setLoaded(false)
    setFrameKey((k) => k + 1)
    if (push) {
      const next = [...history.slice(0, historyIndex + 1), normalized]
      setHistory(next)
      setHistoryIndex(next.length - 1)
    }
  }

  const goBack = () => {
    if (historyIndex <= 0) return
    const target = history[historyIndex - 1]
    setHistoryIndex(historyIndex - 1)
    onUrlChange(target)
    setInput(target)
    setLoaded(false)
    setFrameKey((k) => k + 1)
  }

  const goForward = () => {
    if (historyIndex >= history.length - 1) return
    const target = history[historyIndex + 1]
    setHistoryIndex(historyIndex + 1)
    onUrlChange(target)
    setInput(target)
    setLoaded(false)
    setFrameKey((k) => k + 1)
  }

  const browserPresets = [
    { label: t('explorer.browser.devService'), url: 'http://localhost:5174' },
    { label: t('explorer.browser.apiDocs'), url: 'http://localhost:5000/scalar/v1' },
    { label: 'GitHub', url: 'https://github.com' },
  ]

  if (!url) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">{t('explorer.tabs.browser')}</h3>
        </div>
        <div className="mb-3 flex gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(input)}
            placeholder={t('explorer.browser.urlPlaceholder')}
            className="min-w-0 flex-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800"
          />
          <button onClick={() => navigate(input)} className="shrink-0 rounded-full bg-blue-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-600">
            {t('explorer.browser.go')}
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{t('explorer.browser.quickLinks')}</p>
          {browserPresets.map((p) => (
            <button
              key={p.url}
              onClick={() => navigate(p.url)}
              className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left transition-all hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-500/40 dark:hover:bg-blue-950/20"
            >
              <Globe size={13} className="shrink-0 text-blue-500" />
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-gray-700 dark:text-gray-200">{p.label}</div>
                <div className="truncate text-[10px] text-gray-400">{p.url}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-4 text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">
          {t('explorer.browser.iframeHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具条 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
        <button onClick={goBack} disabled={historyIndex <= 0} className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/[0.06]" title={t('explorer.browser.back')}>
          <ArrowLeft size={13} />
        </button>
        <button onClick={goForward} disabled={historyIndex >= history.length - 1} className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/[0.06]" title={t('explorer.browser.forward')}>
          <ArrowRight size={13} />
        </button>
        <button onClick={() => { setLoaded(false); setFrameKey((k) => k + 1) }} className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]" title={t('explorer.browser.refresh')}>
          <RotateCcw size={13} />
        </button>
        <button onClick={() => navigate('http://localhost:5174')} className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]" title={t('explorer.browser.goHome')}>
          <Home size={13} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate(input)}
          className="min-w-0 flex-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] outline-none focus:border-blue-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800"
        />
        <button onClick={() => navigate(input)} className="shrink-0 rounded-full bg-blue-500 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600">
          {t('explorer.browser.go')}
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]" title={t('explorer.browser.openInSystem')}>
          <ExternalLink size={13} />
        </a>
      </div>
      {/* 页面 */}
      <div className="relative min-h-0 flex-1 bg-white dark:bg-gray-950">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-400">
            <Loader2 size={16} className="mr-2 animate-spin" />
            {t('explorer.loading')}
          </div>
        )}
        <iframe
          key={frameKey}
          src={url}
          title={t('explorer.embeddedBrowser')}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  )
}

