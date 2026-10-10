import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { shareService } from '../services/shareService';
import { formatDateTime } from '../utils/locale';
import ThemedMarkdown from '../components/ThemedMarkdown';

export default function SharedNotePage() {
  const { t } = useTranslation('notes');
  const { shareCode } = useParams<{ shareCode: string }>();

  const { data: note, isLoading, error } = useQuery({
    queryKey: ['sharedNote', shareCode],
    queryFn: () => shareService.getSharedNote(shareCode!),
    enabled: !!shareCode,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500">{t('common:loading')}</div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">{t('share.unavailable')}</h1>
          <p className="text-gray-500">{t('share.unavailableHint')}</p>
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
              {note.title || t('note.untitled')}
            </h1>
            <div className="mt-2 text-sm text-gray-500">
              {t('note.updated', { time: formatDateTime(note.updatedAt) })}
            </div>
          </header>
          <ThemedMarkdown source={note.content} />
        </div>
        <footer className="mt-4 text-center text-sm text-gray-400">
          {t('share.poweredBy')}
        </footer>
      </div>
    </div>
  );
}
