import { useState, useRef } from 'react'
import { Download, Database, Upload, AlertCircle, Loader2 } from 'lucide-react'
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
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm shadow-amber-500/25">
          <Download size={16} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">导出与备份</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">导出笔记、备份和恢复数据库</p>
        </div>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleExportNotes}
          disabled={isLoading}
          className="group flex items-center gap-3 rounded-xl border border-gray-200/80 bg-white px-4 py-4 text-left shadow-sm transition-all hover:border-blue-200 hover:shadow-md hover:shadow-blue-500/5 dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:border-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-500 transition-colors group-hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400">
            <Download size={18} />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">导出 Markdown</div>
            <div className="text-xs text-gray-400 dark:text-gray-500">将所有笔记导出为 ZIP</div>
          </div>
        </button>

        <button
          onClick={handleBackup}
          disabled={isLoading}
          className="group flex items-center gap-3 rounded-xl border border-gray-200/80 bg-white px-4 py-4 text-left shadow-sm transition-all hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-500/5 dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:border-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-500 transition-colors group-hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400">
            <Database size={18} />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200">备份数据库</div>
            <div className="text-xs text-gray-400 dark:text-gray-500">下载 SQLite 数据库文件</div>
          </div>
        </button>
      </div>

      {/* Restore Section */}
      <div className="rounded-xl border border-gray-200/80 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-500 dark:bg-amber-500/10 dark:text-amber-400">
            <Upload size={15} />
          </div>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">恢复数据库</span>
        </div>
        <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
          上传之前的 .db 备份文件恢复数据。恢复后需要重启应用才能生效。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".db"
          onChange={handleRestore}
          disabled={isLoading}
          className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-amber-700 hover:file:bg-amber-100 dark:file:bg-amber-500/10 dark:file:text-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
          <Loader2 size={14} className="animate-spin" />
          <span>处理中...</span>
        </div>
      )}

      {/* Message */}
      {message && !isLoading && (
        <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </section>
  )
}
