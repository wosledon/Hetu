import { useState } from 'react';
import { Database, Loader2 } from 'lucide-react';
import { settingService } from '../services/settingService';

type Provider = 'Sqlite' | 'Postgresql';

const inputClass = 'w-full max-w-md rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm font-mono outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20';
const selectClass = 'w-full max-w-md rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20';

export default function DatabaseSettings() {
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
        message: result.message || (result.canConnect ? '连接成功' : '连接失败'),
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : '测试失败',
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
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">数据库存储</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">配置数据库连接</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">数据库类型</label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as Provider)}
            className={selectClass}
          >
            <option value="Sqlite">SQLite（本地文件）</option>
            <option value="Postgresql">PostgreSQL</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">连接字符串</label>
          <input
            type="text"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            className={inputClass}
          />
        </div>

        <button
          onClick={handleTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-emerald-500/25 transition-all hover:bg-emerald-600 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : null}
          {testing ? '测试中...' : '测试连接'}
        </button>

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
          修改数据库配置后需要重启后端服务才能生效。建议将 PostgreSQL 连接字符串配置到环境变量或 User Secrets 中。
        </p>
      </div>
    </section>
  );
}
