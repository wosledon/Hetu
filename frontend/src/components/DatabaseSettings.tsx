import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Loader2 } from 'lucide-react';
import { settingService } from '../services/settingService';
import Select from './Select';
import { Button, Input } from './ui';

type Provider = 'Sqlite' | 'Postgresql';

export default function DatabaseSettings() {
  const { t } = useTranslation('settings');
  const [provider, setProvider] = useState<Provider>('Sqlite');
  const [connectionString, setConnectionString] = useState('Data Source=hetu.db');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const defaultConnections: Record<Provider, string> = {
    Sqlite: 'Data Source=hetu.db',
    Postgresql: 'Host=localhost;Database=hetu;Username=postgres;Password=',
  };

  const handleProviderChange = (value: Provider) => {
    setProvider(value);
    setConnectionString(defaultConnections[value]);
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await settingService.testDatabase({ provider, connectionString });
      setTestResult({
        success: result.canConnect,
        message: result.message || (result.canConnect ? t('database.connectSuccess') : t('database.connectFailed')),
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : t('database.testFailed'),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/25">
          <Database size={16} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">{t('database.title')}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('database.subtitle')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('database.type')}</label>
          <Select
          value={provider}
          onChange={(value) => handleProviderChange(value as Provider)}
          options={[
            { value: 'Sqlite', label: t('database.sqlite') },
            { value: 'Postgresql', label: t('database.postgresql') },
          ]}
        />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('database.connectionString')}</label>
          <Input
            type="text"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            className="max-w-md font-mono"
          />
        </div>

        <Button variant="primary" tone="emerald" className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-emerald-500/25 transition-all hover:bg-emerald-600 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleTest}
          disabled={testing}>
          {testing ? <Loader2 size={14} className="animate-spin" /> : null}
          {testing ? t('database.testing') : t('database.testConnection')}
        </Button>

        {testResult && (
          <div
            className={`rounded-xl border p-4 text-sm ${
              testResult.success
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300'
            }`}
          >
            {testResult.message}
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('database.hint')}
        </p>
      </div>
    </section>
  );
}
