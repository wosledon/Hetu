import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import { tagService } from '../services/tagService'
import { tagPalette, TAG_COLOR_HEX } from '../utils/tagColor'
import type { ITag } from '../types'

interface TagInputProps {
  noteId: string
  tags: ITag[]
}

export function TagInput({ noteId, tags: tagsProp }: TagInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedColor, setSelectedColor] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 直接查询该笔记的最新标签，避免依赖父组件传入的快照（标签增删后能实时回流）
  const { data: noteTags } = useQuery({
    queryKey: ['tags', 'note', noteId],
    queryFn: () => tagService.getByNote(noteId),
    enabled: !!noteId,
  })
  const tags = noteTags ?? tagsProp

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: tagService.getAll,
  })

  const setNoteTags = useMutation({
    mutationFn: (tagIds: string[]) => tagService.setNoteTags(noteId, { tagIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['tags', 'note', noteId] })
    },
  })

  const createTag = useMutation({
    mutationFn: tagService.create,
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      const newTagIds = [...tags.map((t) => t.id), newTag.id]
      setNoteTags.mutate(newTagIds)
      setInput('')
      setSelectedColor('')
      setIsOpen(false)
    },
  })

  const availableTags = allTags.filter(
    (tag) => !tags.some((t) => t.id === tag.id) && tag.name.toLowerCase().includes(input.toLowerCase())
  )

  const handleAddTag = (tag: ITag) => {
    const newTagIds = [...tags.map((t) => t.id), tag.id]
    setNoteTags.mutate(newTagIds)
    setInput('')
    setSelectedColor('')
    setIsOpen(false)
  }

  const handleRemoveTag = (tagId: string) => {
    const newTagIds = tags.filter((t) => t.id !== tagId).map((t) => t.id)
    setNoteTags.mutate(newTagIds)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault()
      const existing = allTags.find((t) => t.name.toLowerCase() === input.trim().toLowerCase())
      if (existing) {
        handleAddTag(existing)
      } else {
        createTag.mutate({ name: input.trim(), color: selectedColor || undefined })
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => {
        const palette = tagPalette(tag)
        return (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{ background: palette.soft, color: palette.text }}
          >
            {tag.name}
            <button
              onClick={() => handleRemoveTag(tag.id)}
              className="opacity-60 hover:opacity-100"
              title="移除标签"
            >
              <X size={12} />
            </button>
          </span>
        )
      })}

      <div className="relative">
        <button
          onClick={() => {
            setIsOpen(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-600"
        >
          <Plus size={12} />
          添加标签
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入标签名，回车创建"
                className="w-full rounded border border-gray-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-gray-700"
              />
              <div className="mt-2">
                <div className="mb-1 px-1 text-[10px] text-gray-400">颜色（新建标签生效）</div>
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                  <button
                    onClick={() => setSelectedColor('')}
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 bg-gray-200 dark:bg-gray-600 ${
                      selectedColor === '' ? 'border-gray-700 dark:border-white' : 'border-gray-200 dark:border-gray-600'
                    }`}
                    title="不设颜色（灰色）"
                  >
                    {selectedColor === '' && <Check size={11} className="text-gray-700 dark:text-white" />}
                  </button>
                  {Object.entries(TAG_COLOR_HEX).map(([name, hex]) => (
                    <button
                      key={name}
                      onClick={() => setSelectedColor(name)}
                      className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${
                        selectedColor === name ? 'border-gray-700 dark:border-white' : 'border-transparent'
                      }`}
                      style={{ background: hex.dot }}
                      title={name}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-2 max-h-40 overflow-y-auto">
                {availableTags.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-gray-400">
                    {input.trim() ? '按回车创建新标签' : '暂无可用标签'}
                  </div>
                ) : (
                  availableTags.map((tag) => {
                    const palette = tagPalette(tag)
                    return (
                      <button
                        key={tag.id}
                        onClick={() => handleAddTag(tag)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: palette.dot }}
                        />
                        <span className="truncate">{tag.name}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
