import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import ChatSidebar from '../components/ChatSidebar'
import ChatTopicList from '../components/ChatTopicList'
import ChatTree from '../components/ChatTree'
import ChatMessageArea from '../components/ChatMessageArea'
import { chatGroupService, chatTopicService } from '../services/chatService'
import { useUIStore } from '../stores/uiStore'
import type { IChatGroup, IChatTopic } from '../types'

export default function ChatPage() {
  // undefined 表示跟随默认选择（主对话或首个分组/话题），null 表示显式清空
  const [groupChoice, setGroupChoice] = useState<IChatGroup | null | undefined>(undefined)
  const [topicChoice, setTopicChoice] = useState<IChatTopic | null | undefined>(undefined)
  const secondaryMenuStyle = useUIStore((state) => state.secondaryMenuStyle)
  const collapsed = secondaryMenuStyle === 'collapsed'

  // 主对话（全局主对话组 + 唯一主话题）
  const { data: mainChat } = useQuery({
    queryKey: ['chatMain'],
    queryFn: chatGroupService.getMain,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['chatGroups'],
    queryFn: chatGroupService.getAll,
  })

  const activeGroup = groupChoice ?? mainChat?.group ?? groups[0] ?? null

  const { data: topics = [] } = useQuery({
    queryKey: ['chatTopics', activeGroup?.id],
    queryFn: () => (activeGroup ? chatTopicService.getByGroup(activeGroup.id) : Promise.resolve([])),
    enabled: !!activeGroup,
  })

  // 主对话分组默认选中唯一的主话题，普通分组默认选中第一个话题
  const defaultTopic = mainChat && activeGroup?.id === mainChat.group.id ? mainChat.topic : topics[0] ?? null
  const activeTopic = topicChoice === undefined ? defaultTopic : topicChoice
  const selectedMain = mainChat != null && activeTopic?.id === mainChat.topic.id

  const handleSelectMain = useCallback(() => {
    if (!mainChat) return
    setGroupChoice(mainChat.group)
    setTopicChoice(mainChat.topic)
  }, [mainChat])

  const handleSelectGroup = useCallback((group: IChatGroup) => {
    setGroupChoice(group)
    setTopicChoice(undefined)
  }, [])

  const handleSelectTopic = useCallback((topic: IChatTopic) => {
    setTopicChoice(topic)
  }, [])

  const handleDeleteTopic = useCallback(() => setTopicChoice(null), [])

  return (
    <AppLayout showSidebar={false} mainContent={
      activeTopic ? (
        <ChatMessageArea
          key={activeTopic.id}
          topic={activeTopic}
          group={activeGroup ?? undefined}
          onTopicUpdated={setTopicChoice}
        />
      ) : (
        <ChatMessageArea topic={undefined} group={activeGroup ?? undefined} onTopicUpdated={setTopicChoice} />
      )
    }>
      {collapsed ? (
        <ChatTree
          mainChat={mainChat}
          selectedMain={selectedMain}
          selectedGroupId={activeGroup?.id}
          selectedTopicId={activeTopic?.id}
          onSelectGroup={handleSelectGroup}
          onSelectTopic={handleSelectTopic}
          onSelectMain={handleSelectMain}
          onDeleteTopic={handleDeleteTopic}
        />
      ) : (
        <>
          <ChatSidebar
            mainChat={mainChat}
            selectedMain={selectedMain}
            selectedGroupId={activeGroup?.id}
            onSelectGroup={handleSelectGroup}
            onSelectMain={handleSelectMain}
          />
          <ChatTopicList
            groupId={activeGroup?.id}
            isMainGroup={selectedMain}
            selectedTopicId={activeTopic?.id}
            onSelectTopic={handleSelectTopic}
            onDeleteTopic={handleDeleteTopic}
          />
        </>
      )}
    </AppLayout>
  )
}
