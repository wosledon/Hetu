import { Cpu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import AppLayout from '../components/AppLayout'
import { Button, PageContainer } from '../components/ui'

export default function ModelsPage() {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <PageContainer variant="fill" className="items-center justify-center">
          <div className="w-full max-w-sm rounded-2xl border border-gray-200/70 bg-white/65 px-8 py-10 text-center shadow-sm dark:border-white/[0.07] dark:bg-slate-900/35">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
              <Cpu size={28} />
            </div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('models.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{t('models.comingSoon')}</p>
            <Button variant="secondary" className="mt-5 rounded-xl border border-gray-200/80 bg-white/80 px-4 py-2 text-sm text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300" onClick={() => navigate('/settings')}>
              {t('common:settings')}
            </Button>
          </div>
        </PageContainer>
      }
    />
  )
}