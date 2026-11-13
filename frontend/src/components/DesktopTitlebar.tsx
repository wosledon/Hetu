import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMemo, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '../stores/uiStore'
import { WindowControls } from './WindowControls'

export default function DesktopTitlebar() {
  const { t } = useTranslation()
  const navStyle = useUIStore((state) => state.navStyle)
  const navCollapsed = useUIStore((state) => state.navCollapsed)
  const toggleNav = useUIStore((state) => state.toggleNav)
  const currentWindow = useMemo(() => getCurrentWindow(), [])
  const [maximized, setMaximized] = useState(false)

  const toggleMaximize = async () => {
    try {
      await currentWindow.toggleMaximize()
      setMaximized(await currentWindow.isMaximized())
    } catch (error) {
      console.error('Failed to toggle window maximize', error)
    }
  }

  return (
    <header className="desktop-titlebar flex h-9 shrink-0 select-none items-center border-b border-gray-200/70 bg-white/80 dark:border-white/[0.07] dark:bg-gray-900/80">
      <div className="flex h-full shrink-0 items-center px-2">
        {navStyle === 'verticalList' && (
          <button
            type="button"
            aria-label={t(navCollapsed ? 'nav:expandNav' : 'nav:collapseNav')}
            title={t(navCollapsed ? 'nav:expandNav' : 'nav:collapseNav')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-gray-100"
            onClick={toggleNav}
          >
            {navCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}
      </div>
      <div
        className="h-full min-w-8 flex-1 cursor-default"
        onMouseDown={(event) => {
          if (event.button === 0) void currentWindow.startDragging().catch((error: unknown) => console.error('Failed to drag window', error))
        }}
        onDoubleClick={() => { void toggleMaximize() }}
      />
      <WindowControls maximized={maximized} onMaximize={() => { void toggleMaximize() }} />
    </header>
  )
}
