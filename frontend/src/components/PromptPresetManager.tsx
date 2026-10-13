import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Edit2, Check, X, Download, Upload, RefreshCw } from 'lucide-react'
import { promptPresetService } from '../services/promptPresetService'
import type { IPromptPreset } from '../types'
import { Button, Input, Textarea } from './ui'

export default function PromptPresetManager() {
  const { t } = useTranslation('chat')
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
        <h2 className="text-lg font-medium">{t('presets.title')}</h2>
        <div className="flex gap-2">
          <Button variant="outline" tone="gray" className="flex items-center gap-1 px-3 py-1.5 hover:bg-gray-100" onClick={handleExport}
            
            title={t('presets.exportTitle')}>
            <Download size={14} />
            {t('common:export')}
          </Button>
          <Button variant="outline" tone="gray" className="flex items-center gap-1 px-3 py-1.5 hover:bg-gray-100" onClick={() => fileInputRef.current?.click()}
            
            title={t('presets.importTitle')}>
            <Upload size={14} />
            {t('common:import')}
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          {!isCreating && !editingId && (
            <Button variant="primary" tone="indigo" className="flex items-center gap-1 px-3 py-1.5 hover:bg-indigo-700" onClick={() => setIsCreating(true)}>
              <Plus size={14} />
              {t('common:create')}
            </Button>
          )}
        </div>
      </div>

      {(isCreating || editingId) && (
        <div className="space-y-2 p-3 border border-gray-200 dark:border-gray-700 rounded-md">
          <Input tone="blue"
            type="text"
            placeholder={t('shared.category')}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full"
          />
          <Input tone="blue"
            type="text"
            placeholder={t('common:name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full"
          />
          <Textarea tone="blue"
            placeholder={t('presets.contentPlaceholder')}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="w-full h-24 resize-none"
          />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Input tone="blue"
                type="text"
                placeholder={t('presets.variablesPlaceholder')}
                value={form.variables}
                onChange={(e) => setForm({ ...form, variables: e.target.value })}
                className="flex-1"
              />
              {extractedVars.length > 0 && (
                <Button variant="outline" tone="gray" size="sm" className="flex items-center gap-1 px-2 py-2 hover:bg-gray-100" onClick={handleAutoExtractVars}
                  
                  title={t('presets.autoExtractTitle')}>
                  <RefreshCw size={12} />
                  {t('presets.extract')}
                </Button>
              )}
            </div>
            {extractedVars.length > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                {t('presets.detectedVariables', { vars: extractedVars.map(v => `{{${v}}}`).join(', ') })}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" tone="emerald" className="flex items-center gap-1 px-3 py-1.5 hover:bg-emerald-700" onClick={handleSave}>
              <Check size={14} />
              {t('common:save')}
            </Button>
            <button
              onClick={() => {
                setIsCreating(false)
                setEditingId(null)
                setForm({ category: '', name: '', content: '', variables: '' })
              }}
              className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
            >
              <X size={14} />
              {t('common:cancel')}
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
                      <Button variant="ghost" tone="gray" surface="modal" className="p-1 text-gray-500 hover:bg-gray-300" onClick={() => startEdit(preset)}>
                        <Edit2 size={14} />
                      </Button>
                      <Button variant="link" tone="gray" className="p-1 text-gray-500 hover:text-indigo-600" onClick={() => deleteMutation.mutate(preset.id)}>
                        <Trash2 size={14} />
                      </Button>
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
