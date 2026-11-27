import { useCallback, useEffect, useRef, useState } from 'react'

export interface ImageAttachment {
  id: string
  file: File
  /** 预览地址：移除/发送/卸载时统一释放 */
  url: string
}

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`

/**
 * 图片附件（粘贴 / 选择）：只收图片、按「名称+大小+修改时间」去重，
 * 负责预览 URL 的创建与释放。两份会话输入框共用。
 */
export function useImageAttachments() {
  const [items, setItems] = useState<ImageAttachment[]>([])
  const itemsRef = useRef<ImageAttachment[]>([])
  const seqRef = useRef(0)

  const commit = (next: ImageAttachment[]) => {
    itemsRef.current = next
    setItems(next)
  }

  /** 加入图片；返回是否至少加入了一张（非图片会被忽略） */
  const add = useCallback((files: File[]): boolean => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length === 0) return false
    const seen = new Set(itemsRef.current.map((item) => fileKey(item.file)))
    const additions: ImageAttachment[] = []
    for (const file of images) {
      const key = fileKey(file)
      if (seen.has(key)) continue
      seen.add(key)
      additions.push({ id: `img-${seqRef.current++}`, file, url: URL.createObjectURL(file) })
    }
    if (additions.length > 0) commit([...itemsRef.current, ...additions])
    return true
  }, [])

  const remove = useCallback((id: string) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (!target) return
    URL.revokeObjectURL(target.url)
    commit(itemsRef.current.filter((item) => item.id !== id))
  }, [])

  const clear = useCallback(() => {
    for (const item of itemsRef.current) URL.revokeObjectURL(item.url)
    commit([])
  }, [])

  useEffect(() => () => {
    for (const item of itemsRef.current) URL.revokeObjectURL(item.url)
    itemsRef.current = []
  }, [])

  return {
    items,
    files: items.map((item) => item.file),
    add,
    remove,
    clear,
  }
}