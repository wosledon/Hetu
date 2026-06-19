import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { shareService } from '../services/shareService';
import ThemedMarkdown from '../components/ThemedMarkdown';

export default function SharedNotePage() {
  const { shareCode } = useParams<{ shareCode: string }>();

  const { data: note, isLoading, error } = useQuery({
    queryKey: ['sharedNote', shareCode],
    queryFn: () => shareService.getSharedNote(shareCode!),
    enabled: !!shareCode,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">笔记不可用</h1>
          <p className="text-gray-500">该分享链接可能已过期、被禁用或不存在</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <header className="mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
              {note.title || '未命名笔记'}
            </h1>
            <div className="mt-2 text-sm text-gray-500">
              更新于 {new Date(note.updatedAt).toLocaleString('zh-CN')}
            </div>
          </header>
          <ThemedMarkdown source={note.content} />
        </div>
        <footer className="mt-4 text-center text-sm text-gray-400">
          由 Hetu 提供分享服务
        </footer>
      </div>
    </div>
  );
}
