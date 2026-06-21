import { useState, useRef } from 'react'
import { Download, Database, Upload, AlertCircle } from 'lucide-react'
import { exportService } from '../services/exportService'

export default function ExportBackupPanel() {
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExportNotes = async () => {
    setIsLoading(true)
    setMessage(null)
    try {
      await exportService.exportNotes()
      setMessage('笔记导出已开始')
    } catch (error) {
      setMessage('导出失败：' + (error instanceof Error ? error.message : '未知错误'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleBackup = async () => {
    setIsLoading(true)
    setMessage(null)
    try {
      await exportService.backupDatabase()
      setMessage('数据库备份已开始')
    } catch (error) {
      setMessage('备份失败：' + (error instanceof Error ? error.message : '未知错误'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsLoading(true)
    setMessage(null)
    try {
      const result = await exportService.restoreDatabase(file)
      setMessage(result)
    } catch (error) {
      setMessage('恢复失败：' + (error instanceof Error ? error.message : '未知错误'))
    } finally {
      setIsLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-md font-semibold text-gray-800 dark:text-gray-100">导出与备份</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={handleExportNotes}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 text-left"
        >
          <Download size={18} className="text-indigo-600" />
          <div>
            <div className="font-medium text-sm">导出 Markdown</div>
            <div className="text-xs text-gray-500">将所有笔记导出为 ZIP</div>
          </div>
        </button>

        <button
          onClick={handleBackup}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 text-left"
        >
          <Database size={18} className="text-emerald-600" />
          <div>
            <div className="font-medium text-sm">备份数据库</div>
            <div className="text-xs text-gray-500">下载 SQLite 数据库文件</div>
          </div>
        </button>
      </div>

      <div className="p-3 border border-gray-200 dark:border-gray-700 rounded-md">
        <div className="flex items-center gap-2 mb-2">
          <Upload size={16} className="text-amber-600" />
          <span className="font-medium text-sm">恢复数据库</span>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          上传之前的 .db 备份文件恢复数据。恢复后需要重启应用才能生效。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".db"
          onChange={handleRestore}
          disabled={isLoading}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 disabled:opacity-50"
        />
      </div>

      {message && (
        <div className="flex items-start gap-2 text-sm p-3 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-200">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </section>
  )
}
