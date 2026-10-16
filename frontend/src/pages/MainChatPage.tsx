import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ChatMessageArea from '../components/ChatMessageArea'
import { chatGroupService } from '../services/chatService'

/**
 * 主对话：全局唯一的对话，从左侧固定菜单进入并作为首页。
 * 主对话组 / 主话题由后端按需创建（GET /api/chat-groups/main），此处只负责渲染。
 */
export default function MainChatPage() {
  const { data: mainChat, isLoading } = useQuery({
    queryKey: ['chatMain'],
    queryFn: chatGroupService.getMain,
  })

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        isLoading || !mainChat ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 size={18} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <ChatMessageArea key={mainChat.topic.id} topic={mainChat.topic} group={mainChat.group} />
        )
      }
    />
  )
}
