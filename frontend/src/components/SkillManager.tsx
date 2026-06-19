import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react'
import { skillService } from '../services/skillService'
import type { ISkill } from '../types'

const defaultConfig = JSON.stringify(
  {
    promptTemplate: '请处理以下内容：\n\n{{input}}',
    systemPrompt: '你是智能助手。',
  },
  null,
  2
)

export default function SkillManager() {
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    category: '',
    name: '',
    description: '',
    config: defaultConfig,
    isEnabled: true,
    sortOrder: 0,
  })

  const { data: skills = [] } = useQuery({
    queryKey: ['skills'],
    queryFn: () => skillService.getAll(),
  })

  const createMutation = useMutation({
    mutationFn: skillService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] })
      setIsCreating(false)
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof skillService.update>[1] }) =>
      skillService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] })
      setEditingId(null)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: skillService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const resetForm = () => {
    setForm({
      category: '',
      name: '',
      description: '',
      config: defaultConfig,
      isEnabled: true,
      sortOrder: 0,
    })
  }

  const startEdit = (skill: ISkill) => {
    setEditingId(skill.id)
    setForm({
      category: skill.category,
      name: skill.name,
      description: skill.description,
      config: skill.config || defaultConfig,
      isEnabled: skill.isEnabled,
      sortOrder: skill.sortOrder,
    })
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.description.trim()) return
    const data = {
      category: form.category,
      name: form.name,
      description: form.description,
      config: form.config,
      isEnabled: form.isEnabled,
      sortOrder: form.sortOrder,
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data })
    } else {
      createMutation.mutate({
        category: form.category,
        name: form.name,
        description: form.description,
        config: form.config,
      })
    }
  }

  const grouped = skills.reduce<Record<string, ISkill[]>>((acc, skill) => {
    if (!acc[skill.category]) acc[skill.category] = []
    acc[skill.category].push(skill)
    return acc
  }, {})

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Skill 技能</h2>
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
            placeholder="名称（英文，用于 /name 触发）"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
          />
          <input
            type="text"
            placeholder="描述"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
          />
          <textarea
            placeholder='Config JSON，如 { "promptTemplate": "...", "systemPrompt": "..." }'
            value={form.config}
            onChange={(e) => setForm({ ...form, config: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm h-32 resize-none font-mono"
          />
          {editingId && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
              />
              启用
            </label>
          )}
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
                resetForm()
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
              {items.map((skill) => (
                <div
                  key={skill.id}
                  className={`flex items-start justify-between p-3 border rounded-md ${
                    skill.isEnabled
                      ? 'border-gray-200 dark:border-gray-700'
                      : 'border-gray-100 dark:border-gray-800 opacity-60'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm">/{skill.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{skill.description}</div>
                  </div>
                  {!skill.isBuiltIn && (
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={() => startEdit(skill)}
                        className="p-1 text-gray-500 hover:text-indigo-600"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(skill.id)}
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
