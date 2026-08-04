import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, Loader2, X, Globe, GitCompare, FileCode, PanelRightClose } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { workFileService, workSessionService } from '../../services/workService'
import { useUIStore } from '../../stores/uiStore'
import type { IWorkFileEntry, IWorkFileContent, IWorkFileChange } from '../../types/work'
import WorkDiffView from './WorkDiffView'

interface WorkExplorerProps {
  projectId?: string
  sessionId?: string
  onCollapse?: () => void
}

interface TreeNode extends IWorkFileEntry {
  children?: TreeNode[]
  loaded?: boolean
}

type NavTab = 'files' | 'changes' | 'browser'

interface OpenTab {
  key: string
  label: string
  kind: 'file' | 'diff'
  file?: IWorkFileContent
  change?: IWorkFileChange
}

export default function WorkExplorer({ projectId, sessionId, onCollapse }: WorkExplorerProps) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<NavTab>('files')
  const [browserUrl, setBrowserUrl] = useState('')
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const { data: changes = [] } = useQuery({
    queryKey: ['workFileChanges', sessionId],
    queryFn: () => (sessionId ? workSessionService.getFileChanges(sessionId) : Promise.resolve([])),
    enabled: !!sessionId,
  })

  const loadDir = useCallback(async (path: string) => {
    if (!projectId) return []
    const entries = await workFileService.list(projectId, path || undefined)
    return entries
  }, [projectId])

  const loadRoot = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError('')
    try {
      const entries = await loadDir('')
      setTree(entries)
      setExpanded((prev) => {
        const next = new Set(prev)
        next.add('')
        return next
      })
    } catch (e) {
      setTree([])
      setError(e instanceof Error ? e.message : '读取目录失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, loadDir])

  useEffect(() => {
    setTree([])
    setExpanded(new Set())
    setError('')
    loadRoot()
  }, [projectId, loadRoot])

  // 切换项目时关闭所有标签页
  useEffect(() => {
    setTabs([])
    setActiveKey(null)
    setSelectedPath(null)
  }, [projectId])

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
    } catch { /* ignore */ }
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

    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(nodePath)) next.delete(nodePath)
      else next.add(nodePath)
      return next
    })

    if (!node.loaded) {
      try {
        const children = await loadDir(nodePath)
        setTree((prevTree) => {
          const patch = (nodes: TreeNode[], parent: string): TreeNode[] =>
            nodes.map((n) => {
              const cur = parent ? `${parent}/${n.name}` : n.name
              if (cur === nodePath) return { ...n, children, loaded: true }
              if (n.children) return { ...n, children: patch(n.children, cur) }
              return n
            })
          return patch(prevTree, '')
        })
      } catch { /* ignore */ }
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

  const activeTab = tabs.find((t) => t.key === activeKey)

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
          {navBtn('browser', '浏览器', Globe)}
          <button onClick={loadRoot} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]">
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
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${change.action === 'create' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                    {change.action === 'create' ? '新增' : '修改'}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading && <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-gray-400" /></div>}
            {!loading && error && <div className="px-2 py-6 text-center text-xs text-red-500 dark:text-red-400">{error}</div>}
            {!loading && !error && tree.length === 0 && <div className="py-8 text-center text-xs text-gray-400">空目录</div>}
            {tree.map((node) => renderNode(node, '', 0))}
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
                  {t.kind === 'diff' ? <GitCompare size={11} className="text-indigo-400" /> : <FileCode size={11} className="text-gray-400" />}
                  <span className="max-w-40 truncate">{t.label}</span>
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
              {activeTab?.kind === 'diff' && activeTab.change && (
                <WorkDiffView change={activeTab.change} />
              )}
              {activeTab?.kind === 'file' && activeTab.file && (
                activeTab.file.isBinary ? (
                  <div className="flex h-full items-center justify-center p-4 text-xs text-gray-400">二进制文件（{activeTab.file.size} bytes）</div>
                ) : (
                  <div className="h-full overflow-auto">
                    <CodeMirror
                      value={activeTab.file.content ?? ''}
                      height="100%"
                      readOnly
                      theme={isDark ? 'dark' : 'light'}
                      extensions={[
                        editorBaseTheme,
                        EditorView.lineWrapping,
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
                )
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
            点击文件或更改在标签页中打开
          </div>
        )}
      </div>
    </div>
  )
}

