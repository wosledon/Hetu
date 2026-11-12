import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { shareService } from '../services/shareService';
import { formatDateTime } from '../utils/locale';
import ThemedMarkdown from '../components/ThemedMarkdown'
import { PageContainer } from '../components/ui';

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
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 mb-2">{t('share.unavailable')}</h1>
          <p className="text-gray-500">{t('share.unavailableHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageContainer>
        <div className="rounded-2xl border border-gray-200/70 bg-white/75 p-6 shadow-sm dark:border-white/[0.07] dark:bg-slate-900/45">
          <header className="mb-6 border-b border-gray-200/80 pb-4 dark:border-white/[0.08]">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
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
      </PageContainer>
    </div>
  );
}
