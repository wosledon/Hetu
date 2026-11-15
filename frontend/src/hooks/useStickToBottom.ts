import { useCallback, useRef, useState } from 'react'

/** 距底部多少像素内仍视为「跟随最新输出」 */
const STICK_THRESHOLD_PX = 56

/**
 * 会话消息区滚动跟随。
 *
 * 流式期间内容会持续增高，若每次都滚到底部，用户向上翻阅历史时会被不断拽回来。
 * 这里改为「贴底才跟随」：用户停在底部时自动跟随新内容，一旦向上滚开就停止跟随，
 * 由「回到底部」按钮显式恢复。
 */
export function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const [following, setFollowing] = useState(true)

  const updateFollowing = useCallback((next: boolean) => {
    if (followingRef.current === next) return
    followingRef.current = next
    setFollowing(next)
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    updateFollowing(el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX)
  }, [updateFollowing])

  /** 内容变化后调用：仍在底部附近才跟随，用户翻历史时不打断 */
  const followBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || !followingRef.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  /** 强制滚到底部并恢复跟随（发送消息、切换会话、点击「回到底部」） */
  const scrollToBottomNow = useCallback(() => {
    updateFollowing(true)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [updateFollowing])

  return { scrollRef, following, onScroll, followBottom, scrollToBottomNow }
}
