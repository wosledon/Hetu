import { Loader2 } from 'lucide-react'
import type { StreamingToolCall, StreamingToolResult } from '../hooks/useStreaming'
import { renderToolName, renderToolResult } from '../utils/toolRendering'

interface ToolCallsPanelProps {
  toolCalls: StreamingToolCall[]
  toolResults: StreamingToolResult[]
}

export default function ToolCallsPanel({ toolCalls, toolResults }: ToolCallsPanelProps) {
  if (toolCalls.length === 0) return null

  return (
    <div className="mt-2 space-y-1">
      {toolCalls.map((tc, i) => {
        const result = toolResults.find(r => r.id === tc.id)
        return (
          <div key={tc.id || i} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2">
              <Loader2 size={12} className={result ? 'text-green-500' : 'text-blue-500 animate-spin'} />
              <span className="font-medium text-gray-700 dark:text-gray-300">{renderToolName(tc.name)}</span>
            </div>
            {result && !result.collapsed && (
              <div className={`mt-1.5 rounded-md px-2.5 py-1.5 text-xs ${result.isError ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'}`}>
                {renderToolResult(tc.name, result.content, result.isError)}
              </div>
            )}
            {!result && (
              <div className="mt-1 text-[11px] text-gray-400">执行中...</div>
            )}
          </div>
        )
      })}
    </div>
  )
}