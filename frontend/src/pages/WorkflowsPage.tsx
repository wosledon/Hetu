import { GitBranch } from 'lucide-react'
import AppLayout from '../components/AppLayout'

export default function WorkflowsPage() {
  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/[0.06]">
              <GitBranch size={32} className="text-gray-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">智能工作流</h2>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">功能开发中，敬请期待</p>
          </div>
        </div>
      }
    />
  )
}
