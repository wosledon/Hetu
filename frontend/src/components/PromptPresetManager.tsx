import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Check, X, Download, Upload, RefreshCw } from 'lucide-react'
import { promptPresetService } from '../services/promptPresetService'
import type { IPromptPreset } from '../types'

export default function PromptPresetManager() {
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ category: '', name: '', content: '', variables: '' })

  const { data: presets = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
  })

  const createMutation = useMutation({
    mutationFn: promptPresetService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      setIsCreating(false)
      setForm({ category: '', name: '', content: '', variables: '' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { category: string; name: string; content: string; variables: string; sortOrder: number } }) =>
      promptPresetService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      setEditingId(null)
      setForm({ category: '', name: '', content: '', variables: '' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: promptPresetService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresets'] }),
  })

  const importMutation = useMutation({
    mutationFn: promptPresetService.import,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresets'] }),
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    const data = await promptPresetService.export()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompt-presets.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const items = JSON.parse(reader.result as string)
        if (Array.isArray(items)) {
          importMutation.mutate(items)
        }
      } catch { /* ignore parse errors */ }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const startEdit = (preset: IPromptPreset) => {
    setEditingId(preset.id)
    setForm({
      category: preset.category,
      name: preset.name,
      content: preset.content,
      variables: preset.variables || '',
    })
  }

  // Extract {{variable}} patterns from content
  const extractedVars = useMemo(() => {
    const matches = form.content.match(/\{\{(\w+)\}\}/g)
    if (!matches) return []
    return [...new Set(matches.map(m => m.slice(2, -2)))]
  }, [form.content])

  const handleAutoExtractVars = () => {
    if (extractedVars.length > 0) {
      setForm({ ...form, variables: JSON.stringify(extractedVars) })
    }
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.content.trim()) return
    if (editingId) {
      const preset = presets.find((p) => p.id === editingId)
      updateMutation.mutate({
        id: editingId,
        data: {
          category: form.category,
          name: form.name,
          content: form.content,
          variables: form.variables,
          sortOrder: preset?.sortOrder ?? 0,
        },
      })
    } else {
      createMutation.mutate({
        category: form.category,
        name: form.name,
        content: form.content,
        variables: form.variables,
      })
    }
  }

  const grouped = presets.reduce<Record<string, IPromptPreset[]>>((acc, preset) => {
    if (!acc[preset.category]) acc[preset.category] = []
    acc[preset.category].push(preset)
    return acc
  }, {})

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">预设提示词</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
            title="导出预设"
          >
            <Download size={14} />
            导出
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
            title="导入预设"
          >
            <Upload size={14} />
            导入
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          {!isCreating && !editingId && (
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1 text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              <Plus size={14} />
              新增
            </button>
          )}
        </div>
      </div>

      {(isCreating || editingId) && (
        <div className="space-y-2 p-3 border border-gray-200 dark:border-gray-700 rounded-md">
          <input
            type="text"
            placeholder="分类"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
          />
          <input
            type="text"
            placeholder="名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
          />
          <textarea
            placeholder="提示词内容，支持 {{变量}} 占位符"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm h-24 resize-none"
          />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <input
                type="text"
                placeholder='变量 JSON 数组，如 ["text"]'
                value={form.variables}
                onChange={(e) => setForm({ ...form, variables: e.target.value })}
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
              />
              {extractedVars.length > 0 && (
                <button
                  onClick={handleAutoExtractVars}
                  className="flex items-center gap-1 text-xs px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="从内容中自动提取变量"
                >
                  <RefreshCw size={12} />
                  提取
                </button>
              )}
            </div>
            {extractedVars.length > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                检测到变量: {extractedVars.map(v => `{{${v}}}`).join(', ')}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1 text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
            >
              <Check size={14} />
              保存
            </button>
            <button
              onClick={() => {
                setIsCreating(false)
                setEditingId(null)
                setForm({ category: '', name: '', content: '', variables: '' })
              }}
              className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
            >
              <X size={14} />
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">{category}</h3>
            <div className="space-y-2">
              {items.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-start justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-md"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{preset.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{preset.content}</div>
                  </div>
                  {!preset.isBuiltIn && (
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={() => startEdit(preset)}
                        className="p-1 text-gray-500 hover:text-indigo-600"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(preset.id)}
                        className="p-1 text-gray-500 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
