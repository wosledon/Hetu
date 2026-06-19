import { useState } from 'react';
import { settingService } from '../services/settingService';

type Provider = 'Sqlite' | 'Postgresql';

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
    <section className="space-y-3">
      <h2 className="text-lg font-medium">数据库存储</h2>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          数据库提供程序
        </label>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as Provider)}
          className="w-full max-w-md px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
        >
          <option value="Sqlite">SQLite（本地文件）</option>
          <option value="Postgresql">PostgreSQL</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          连接字符串
        </label>
        <input
          type="text"
          value={connectionString}
          onChange={(e) => setConnectionString(e.target.value)}
          className="w-full max-w-md px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm font-mono"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {testing ? '测试中...' : '测试连接'}
        </button>
      </div>

      {testResult && (
        <div
          className={`text-sm p-3 rounded-md ${
            testResult.success
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-200'
          }`}
        >
          {testResult.message}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        修改数据库配置后，需要重启后端服务才能生效。建议将 PostgreSQL 连接字符串配置到环境变量或 User Secrets 中。
      </p>
    </section>
  );
}
