import { useState, useEffect, useCallback } from 'react'
import { Folder, File, ChevronRight, ChevronDown, RefreshCw, Loader2, X, Globe } from 'lucide-react'
import { workFileService } from '../../services/workService'
import type { IWorkFileEntry, IWorkFileContent } from '../../types/work'

interface WorkExplorerProps {
  projectId?: string
}

interface TreeNode extends IWorkFileEntry {
  children?: TreeNode[]
  loaded?: boolean
}

const TEXT_EXT = new Set(['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.cs', '.csproj', '.sln', '.py', '.go', '.rs', '.java', '.yaml', '.yml', '.toml', '.xml', '.sh', '.ps1', '.sql', '.env', '.gitignore', '.vue', '.svelte'])

export default function WorkExplorer({ projectId }: WorkExplorerProps) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [file, setFile] = useState<IWorkFileContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'files' | 'browser'>('files')
  const [browserUrl, setBrowserUrl] = useState('')

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
    setFile(null)
    setSelectedPath(null)
    setExpanded(new Set())
    setError('')
    loadRoot()
  }, [projectId, loadRoot])

  const toggleNode = async (node: TreeNode, parentPath: string) => {
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
    if (!node.isDirectory) {
      setSelectedPath(nodePath)
      const content = await workFileService.read(projectId!, nodePath)
      setFile(content)
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

  const isTextFile = (name: string) => {
    const idx = name.lastIndexOf('.')
    if (idx < 0) return false
    return TEXT_EXT.has(name.slice(idx).toLowerCase())
  }

  if (!projectId) {
    return (
      <div className="flex min-w-0 flex-1 flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-1 items-center justify-center text-xs text-gray-400">选择项目后浏览文件</div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-gray-100 px-2 dark:border-gray-800">
        <button
          onClick={() => setTab('files')}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${tab === 'files' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.04]'}`}
        >
          <Folder size={12} /> 文件
        </button>
        <button
          onClick={() => setTab('browser')}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${tab === 'browser' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.04]'}`}
        >
          <Globe size={12} /> 浏览器
        </button>
        <button onClick={loadRoot} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]">
          <RefreshCw size={12} />
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
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading && <div className="flex justify-center py-4"><Loader2 size={14} className="animate-spin text-gray-400" /></div>}
            {!loading && error && <div className="px-2 py-6 text-center text-xs text-red-500 dark:text-red-400">{error}</div>}
            {!loading && !error && tree.length === 0 && <div className="py-8 text-center text-xs text-gray-400">空目录</div>}
            {tree.map((node) => renderNode(node, '', 0))}
          </div>

          {file && (
            <div className="flex max-h-1/2 min-h-0 flex-col border-t border-gray-100 dark:border-gray-800">
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-gray-100 px-2 dark:border-gray-800">
                <File size={12} className="text-gray-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-600 dark:text-gray-300">{file.path}</span>
                <button onClick={() => setFile(null)} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]">
                  <X size={12} />
                </button>
              </div>
              {file.isBinary ? (
                <div className="flex flex-1 items-center justify-center p-4 text-xs text-gray-400">二进制文件（{file.size} bytes）</div>
              ) : isTextFile(file.name) ? (
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-2 font-mono text-[11px] leading-relaxed text-gray-700 dark:text-gray-300">{file.content}</pre>
              ) : (
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 text-[11px] text-gray-600 dark:text-gray-400">{file.content}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
