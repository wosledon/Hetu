import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus } from 'lucide-react'
import { tagService } from '../services/tagService'
import type { ITag } from '../types'

interface TagInputProps {
  noteId: string
  tags: ITag[]
}

export function TagInput({ noteId, tags }: TagInputProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
    },
  })

  const availableTags = allTags.filter(
    (tag) => !tags.some((t) => t.id === tag.id) && tag.name.toLowerCase().includes(input.toLowerCase())
  )

  const handleAddTag = (tag: ITag) => {
    const newTagIds = [...tags.map((t) => t.id), tag.id]
    setNoteTags.mutate(newTagIds)
    setInput('')
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
        createTag.mutate({ name: input.trim() })
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          {tag.name}
          <button
            onClick={() => handleRemoveTag(tag.id)}
            className="hover:text-red-500"
          >
            <X size={12} />
          </button>
        </span>
      ))}

      <div className="relative">
        <button
          onClick={() => {
            setIsOpen(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 hover:border-indigo-400 hover:text-indigo-600"
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
            <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-20 p-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入标签名，回车创建"
                className="w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded bg-transparent outline-none focus:border-indigo-400"
              />
              <div className="mt-1 max-h-32 overflow-y-auto">
                {availableTags.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-gray-400">
                    {input.trim() ? '按回车创建新标签' : '暂无可用标签'}
                  </div>
                ) : (
                  availableTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => handleAddTag(tag)}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    >
                      {tag.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
