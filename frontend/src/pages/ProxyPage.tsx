import { Waypoints } from 'lucide-react'
import AppLayout from '../components/AppLayout'

export default function ProxyPage() {
  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/[0.06]">
            <Waypoints size={28} className="text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">代理服务</h2>
          <p className="mt-1 text-sm text-gray-400">敬请期待</p>
        </div>
      }
    />
  )
}
