import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '../../utils/cn'

/** 菜单锚点（视口坐标）：右键事件的 clientX / clientY，或触发器的 left / bottom */
export interface MenuAnchor {
  x: number
  y: number
}

interface MenuItemBase {
  /** 同一份 items 重用时作 React key；不传则用 label */
  key?: string
  disabled?: boolean
}

export interface MenuAction extends MenuItemBase {
  kind?: 'action'
  label: string
  icon?: ReactNode
  onSelect?: () => void
  /** 危险操作（删除等）：红色文字与悬停底色 */
  danger?: boolean
  /** 选中标记：单选组里标出当前项 */
  checked?: boolean
  /** 行尾附注（如当前值） */
  hint?: string
}

export interface MenuSeparatorItem {
  kind: 'separator'
}

export interface MenuSubmenuItem extends MenuItemBase {
  /** 可省略：有 items 即子菜单 */
  kind?: 'submenu'
  label: string
  icon?: ReactNode
  /** 行尾附注（如当前选中的值） */
  hint?: string
  items: MenuItem[]
}

export type MenuItem = MenuAction | MenuSeparatorItem | MenuSubmenuItem

export interface ContextMenuProps {
  /** 非空即打开；关闭由调用方在 onClose 里把 anchor 置空 */
  anchor: MenuAnchor | null
  items: MenuItem[]
  onClose: () => void
  /** 面板最小宽度，默认 160 */
  minWidth?: number
  /** 面板顶部内容（如搜索框），与菜单项之间加一条分隔线 */
  header?: ReactNode
}

/** 与视口边缘保持的距离 */
const EDGE_PADDING = 8
/** 根菜单与子菜单的层级基数：子菜单逐层加一，保证盖在父面板上；整体低于 Modal 的 z-100 */
const BASE_Z_INDEX = 60

const PANEL_CLASS =
  'fixed overflow-hidden rounded-xl border border-gray-100 bg-white py-1 text-sm shadow-xl glass glass-float dark:border-gray-700 dark:bg-gray-800'

const rowClass = (opts: { active: boolean; danger: boolean; disabled: boolean }) =>
  cn(
    'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
    opts.disabled && 'cursor-not-allowed opacity-40',
    !opts.disabled && opts.danger && 'text-red-600 dark:text-red-400',
    !opts.disabled && !opts.danger && 'text-gray-700 dark:text-gray-200',
    !opts.disabled && opts.active && (opts.danger ? 'bg-red-50 dark:bg-red-950/30' : 'bg-gray-100 dark:bg-gray-700'),
  )

/** 按 items 字段判定子菜单：调用方不必额外记一个 kind，漏写只会静静失效 */
const isSubmenu = (item: MenuItem): item is MenuSubmenuItem => 'items' in item

/** 可键盘导航的行：未禁用的动作项与子菜单项 */
const navigable = (item: MenuItem) => {
  if (item.kind === 'separator' || item.disabled) return false
  return isSubmenu(item) || !!item.onSelect
}

interface MenuPanelProps {
  items: MenuItem[]
  /** 面板左上角的期望位置（视口坐标） */
  x: number
  y: number
  /** 0 = 根菜单；>0 = 子菜单，锚点是父行右缘 */
  depth: number
  minWidth: number
  /** 关闭整个菜单 */
  onClose: () => void
  /** 只关这一层（子菜单用） */
  onCloseSelf?: () => void
  /** 根面板顶部内容（如搜索框） */
  header?: ReactNode
  /** 父面板：子菜单关闭后把焦点还回去 */
  parentRef?: RefObject<HTMLDivElement | null>
}

/**
 * 单层面板。定位不靠 state：先按锚点渲染，量到真实尺寸后直接改 DOM 样式收进视口——
 * 免得每个调用方各自猜一个 `innerWidth - 188` 的魔法数，也避开 set-state-in-effect。
 */
function MenuPanel({ items, x, y, depth, minWidth, onClose, onCloseSelf, header, parentRef }: MenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(-1)
  const [submenu, setSubmenu] = useState<{ index: number; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    // 根菜单从光标处向右下展开；子菜单从父行右缘展开，右侧不够就翻到左边
    const left = depth === 0 && x + width + EDGE_PADDING > window.innerWidth
      ? Math.max(EDGE_PADDING, x - width)
      : x
    let top = y
    if (top + height + EDGE_PADDING > window.innerHeight) {
      top = depth === 0 ? Math.max(EDGE_PADDING, y - height) : Math.max(EDGE_PADDING, window.innerHeight - height - EDGE_PADDING)
    }
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
    el.style.visibility = 'visible'
  }, [x, y, depth])

  // 面板打开即持有键盘焦点：方向键 / Enter / Esc 都在它上面处理。
  // 子菜单也要抢焦点，否则焦点留在根面板，ArrowLeft 永远送不到子菜单里
  useLayoutEffect(() => {
    panelRef.current?.focus()
  }, [])

  const navigableIndices = useMemo(
    () => items.map((item, index) => (navigable(item) ? index : -1)).filter((index) => index >= 0),
    [items],
  )

  const openSubmenu = (index: number) => {
    const row = panelRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
    if (!row) return
    const rect = row.getBoundingClientRect()
    setSubmenu({ index, x: rect.right + 4, y: rect.top - 4 })
    setActive(index)
  }

  /** 当前展开的子菜单项（收窄一次，供渲染处使用） */
  const openSubmenuItem = submenu ? items[submenu.index] : undefined

  const activate = (index: number) => {
    const item = items[index]
    if (!item || item.kind === 'separator' || item.disabled) return
    if (isSubmenu(item)) { openSubmenu(index); return }
    if (!item.onSelect) return
    // 选中即关闭：调用方不必各自再调一次 onClose
    onClose()
    item.onSelect()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 子面板是父面板的 DOM 子节点（portal 到同一容器）：不拦住冒泡的话，
    // 在子菜单里按方向键会一路传到父面板，被它的 ArrowDown/ArrowUp 分支把子菜单关掉
    if (depth > 0) e.stopPropagation()
    const current = navigableIndices.indexOf(active)
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (navigableIndices.length === 0) return
        const step = e.key === 'ArrowDown' ? 1 : -1
        const next = current < 0
          ? (e.key === 'ArrowDown' ? 0 : navigableIndices.length - 1)
          : (current + step + navigableIndices.length) % navigableIndices.length
        setActive(navigableIndices[next])
        setSubmenu(null)
        break
      }
      case 'ArrowRight': {
        const item = active >= 0 ? items[active] : undefined
        if (!item || !isSubmenu(item)) return
        e.preventDefault()
        openSubmenu(active)
        break
      }
      case 'ArrowLeft': {
        if (depth === 0) return
        e.preventDefault()
        onCloseSelf?.()
        // 焦点还给父面板：否则根菜单再也收不到方向键
        parentRef?.current?.focus()
        break
      }
      case 'Enter':
      case ' ': {
        if (active < 0) return
        e.preventDefault()
        activate(active)
        break
      }
      case 'Escape': {
        e.preventDefault()
        e.stopPropagation()
        if (depth > 0) onCloseSelf?.()
        else onClose()
        break
      }
      case 'Home':
      case 'End': {
        if (navigableIndices.length === 0) return
        e.preventDefault()
        setActive(e.key === 'Home' ? navigableIndices[0] : navigableIndices[navigableIndices.length - 1])
        setSubmenu(null)
        break
      }
      default:
        break
    }
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="menu"
      data-ctx-menu-panel=""
      data-depth={depth}
      className={cn(PANEL_CLASS, 'outline-none')}
      style={{ left: x, top: y, minWidth, visibility: 'hidden', zIndex: BASE_Z_INDEX + depth }}
      onKeyDown={onKeyDown}
      // 菜单内的点击不该冒泡成「点了别处」把菜单关掉
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {header && (
        <>
          <div className="px-2.5 pb-2 pt-2">{header}</div>
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
        </>
      )}
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={`sep-${index}`} className="my-1 border-t border-gray-100 dark:border-gray-700" />
        }

        const isActive = active === index

        if (isSubmenu(item)) {
          return (
            <div
              key={item.key ?? item.label}
              data-row-index={index}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={submenu?.index === index}
              className={rowClass({ active: isActive, danger: false, disabled: !!item.disabled })}
              onMouseMove={() => { setActive(index); if (submenu?.index !== index) setSubmenu(null) }}
              onClick={() => { if (!item.disabled) openSubmenu(index) }}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 text-[11px] text-gray-400">{item.hint}</span>}
              <ChevronRight size={13} className="shrink-0 text-gray-400" />
            </div>
          )
        }

        return (
          <div
            key={item.key ?? item.label}
            data-row-index={index}
            role="menuitem"
            aria-disabled={item.disabled}
            className={rowClass({ active: isActive, danger: !!item.danger, disabled: !!item.disabled })}
            onMouseMove={() => { setActive(index); if (submenu) setSubmenu(null) }}
            onClick={() => { if (!item.disabled) activate(index) }}
          >
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.checked && <Check size={13} className="shrink-0 text-blue-500 dark:text-blue-400" />}
            {item.hint && <span className="shrink-0 text-[11px] text-gray-400">{item.hint}</span>}
          </div>
        )
      })}

      {openSubmenuItem && isSubmenu(openSubmenuItem) && (
        <MenuPanel
          items={openSubmenuItem.items}
          x={submenu!.x}
          y={submenu!.y}
          depth={depth + 1}
          minWidth={minWidth}
          onClose={onClose}
          onCloseSelf={() => setSubmenu(null)}
          parentRef={panelRef}
        />
      )}
    </div>
  )
}

/**
 * 统一的右键 / 触发器菜单：portal 到 body、边界翻转、Esc 与外点关闭、方向键导航、子菜单。
 *
 * 原先每个调用方各自 createPortal 一份 `fixed min-w-[168px] …` 再手写
 * `Math.min(menu.x, window.innerWidth - 188)` 猜高度，样式与行为都对不齐；
 * 模态框早已抽成 ui/Modal，这里把菜单也收成同一层。
 */
export default function ContextMenu({ anchor, items, onClose, minWidth = 160, header }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  // 外点关闭：用一个 data 属性覆盖根面板与所有子面板，不必层层传 ref
  useLayoutEffect(() => {
    if (!anchor) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (target?.closest('[data-ctx-menu-panel]')) return
      onClose()
    }
    // 尺寸变化后锚点失去意义，继续挂着只会挡住别的内容
    const onResize = () => onClose()
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('resize', onResize)
    }
  }, [anchor, onClose])

  if (!anchor) return null

  return (
    <div ref={rootRef}>
      {createPortal(
        <MenuPanel
          items={items}
          x={anchor.x}
          y={anchor.y}
          depth={0}
          minWidth={minWidth}
          onClose={onClose}
          header={header}
        />,
        document.body,
      )}
    </div>
  )
}
