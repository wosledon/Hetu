import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Circle, Copy, Diamond, Download, Eraser, Focus, Grid3x3, Hand, Image, LayoutGrid, Maximize,
  MousePointer2, Palette, PenLine, Redo2, Route as RouteIcon, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import type { ConnectorRouteMode, IWhiteboardStyle, WhiteboardTool } from '../../types/whiteboard'
import { FILL_COLORS, STROKE_COLORS, type AutoLayoutDirection } from '../../utils/whiteboard'
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside'
import { Button, IconButton } from '../ui'
import Select, { type SelectOption } from '../Select'

const STROKE_WIDTHS = [1, 2, 4, 6]
const FONT_SIZES = [12, 14, 18, 24, 32]

const TOOLS: { tool: WhiteboardTool; labelKey: string; icon: typeof Square }[] = [
  { tool: 'select', labelKey: 'toolSelect', icon: MousePointer2 },
  { tool: 'pan', labelKey: 'toolPan', icon: Hand },
  { tool: 'rect', labelKey: 'toolRect', icon: Square },
  { tool: 'ellipse', labelKey: 'toolEllipse', icon: Circle },
  { tool: 'diamond', labelKey: 'toolDiamond', icon: Diamond },
  { tool: 'text', labelKey: 'toolText', icon: Type },
  { tool: 'pen', labelKey: 'toolPen', icon: PenLine },
  { tool: 'connector', labelKey: 'toolConnector', icon: RouteIcon },
  { tool: 'eraser', labelKey: 'toolEraser', icon: Eraser },
]

export type WhiteboardSaveState = 'saved' | 'saving' | 'dirty'

/** 浮层触发器通用样式：紧凑、和工具栏图标按钮对齐 */
const TRIGGER_CLS = 'gap-1.5 rounded-lg px-2 py-1 text-xs'

const PANEL_CLS =
  'absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg glass glass-float dark:border-white/[0.08] dark:bg-gray-800'

const COMPACT_SELECT_CLS =
  'rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700'

interface WhiteboardToolbarProps {
  tool: WhiteboardTool
  onToolChange: (tool: WhiteboardTool) => void
  style: IWhiteboardStyle
  onStyleChange: (style: IWhiteboardStyle) => void
  snap: boolean
  onSnapChange: (snap: boolean) => void
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onZoomFit: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onDuplicate: () => void
  onExportPng: () => void
  onExportSvg: () => void
  onPresent: () => void
  saveState: WhiteboardSaveState
  hasSelection: boolean
  layoutDirection: AutoLayoutDirection
  onLayoutDirectionChange: (direction: AutoLayoutDirection) => void
  onAutoLayout: () => void
  canAutoLayout: boolean
  routeMode: ConnectorRouteMode
  onRouteModeChange: (mode: ConnectorRouteMode) => void
}

/** 画板工具栏：工具 / 历史 / 视图常驻，样式与布局收进浮层，避免平铺占满整行 */
export default function WhiteboardToolbar({
  tool, onToolChange, style, onStyleChange, snap, onSnapChange,
  zoom, onZoomIn, onZoomOut, onZoomReset, onZoomFit,
  canUndo, canRedo, onUndo, onRedo, onDelete, onDuplicate,
  onExportPng, onExportSvg, onPresent, saveState, hasSelection,
  layoutDirection, onLayoutDirectionChange, onAutoLayout, canAutoLayout,
  routeMode, onRouteModeChange,
}: WhiteboardToolbarProps) {
  const { t } = useTranslation('whiteboard')
  const [styleOpen, setStyleOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const styleRef = useRef<HTMLDivElement | null>(null)
  const layoutRef = useRef<HTMLDivElement | null>(null)

  useDismissOnOutside(styleOpen, () => setStyleOpen(false), [styleRef])
  useDismissOnOutside(layoutOpen, () => setLayoutOpen(false), [layoutRef])

  const strokeWidthOptions: SelectOption[] = STROKE_WIDTHS.map((width) => ({ value: String(width), label: `${width}px` }))
  const fontSizeOptions: SelectOption[] = FONT_SIZES.map((size) => ({ value: String(size), label: `${size}px` }))
  const routeOptions: SelectOption[] = [
    { value: 'orthogonal', label: t('routeOrthogonal') },
    { value: 'straight', label: t('routeStraight') },
  ]
  const directionOptions: SelectOption[] = [
    { value: 'LR', label: t('layoutLR') },
    { value: 'TB', label: t('layoutTB') },
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ tool: value, labelKey, icon: Icon }) => (
          <IconButton
            key={value}
            label={t(labelKey)}
            variant={tool === value ? 'soft' : 'ghost'}
            tone="blue"
            size="sm"
            onClick={() => onToolChange(value)}
          >
            <Icon size={16} />
          </IconButton>
        ))}
      </div>

      <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-white/10" />

      <div className="flex items-center gap-0.5">
        <IconButton label={t('undo')} size="sm" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label={t('redo')} size="sm" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={16} />
        </IconButton>
        <IconButton label={t('duplicate')} size="sm" disabled={!hasSelection} onClick={onDuplicate}>
          <Copy size={16} />
        </IconButton>
        <IconButton label={t('delete')} size="sm" variant="danger" disabled={!hasSelection} onClick={onDelete}>
          <Trash2 size={16} />
        </IconButton>
      </div>

      <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-white/10" />

      <div className="flex items-center gap-1">
        <IconButton label={t('zoomOut')} size="sm" onClick={onZoomOut}>
          <ZoomOut size={16} />
        </IconButton>
        <span className="w-10 text-center text-xs tabular-nums text-gray-500 dark:text-gray-400">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton label={t('zoomIn')} size="sm" onClick={onZoomIn}>
          <ZoomIn size={16} />
        </IconButton>
        <IconButton label={t('zoomReset')} size="sm" onClick={onZoomReset}>
          <Focus size={16} />
        </IconButton>
        <IconButton label={t('zoomFit')} size="sm" onClick={onZoomFit}>
          <Maximize size={16} />
        </IconButton>
        <IconButton
          label={t('snap')}
          size="sm"
          variant={snap ? 'soft' : 'ghost'}
          tone="blue"
          onClick={() => onSnapChange(!snap)}
        >
          <Grid3x3 size={16} />
        </IconButton>
      </div>

      <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-white/10" />

      {/* 样式：颜色 / 线宽 / 字号收进浮层，工具栏只留一个入口 */}
      <div ref={styleRef} className="relative">
        <Button
          variant={styleOpen ? 'soft' : 'secondary'}
          size="sm"
          tone="blue"
          className={TRIGGER_CLS}
          onClick={() => setStyleOpen(!styleOpen)}
        >
          <Palette size={14} /> {t('style')}
        </Button>
        {styleOpen && (
          <div className={PANEL_CLS}>
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{t('strokeColor')}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {STROKE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={t('strokeColor')}
                      onClick={() => onStyleChange({ ...style, stroke: color })}
                      className={`h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110 ${style.stroke === color ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-800' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{t('fillColor')}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {FILL_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={t('fillColor')}
                      onClick={() => onStyleChange({ ...style, fill: color })}
                      className={`h-5 w-5 rounded border border-black/10 transition-transform hover:scale-110 ${style.fill === color ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-800' : ''}`}
                      style={color === 'transparent'
                        ? { backgroundImage: 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)' }
                        : { backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('strokeWidth')}</span>
                  <Select
                    className="w-full"
                    value={String(style.strokeWidth)}
                    options={strokeWidthOptions}
                    onChange={(value) => onStyleChange({ ...style, strokeWidth: Number(value) })}
                    triggerClassName={COMPACT_SELECT_CLS}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('fontSize')}</span>
                  <Select
                    className="w-full"
                    value={String(style.fontSize)}
                    options={fontSizeOptions}
                    onChange={(value) => onStyleChange({ ...style, fontSize: Number(value) })}
                    triggerClassName={COMPACT_SELECT_CLS}
                  />
                </label>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-400">{t('styleTitle')}</p>
            </div>
          </div>
        )}
      </div>

      {/* 布局：连线样式 / 方向 / 自动布局收进浮层 */}
      <div ref={layoutRef} className="relative">
        <Button
          variant={layoutOpen ? 'soft' : 'secondary'}
          size="sm"
          tone="blue"
          className={TRIGGER_CLS}
          onClick={() => setLayoutOpen(!layoutOpen)}
        >
          <LayoutGrid size={14} /> {t('layout')}
        </Button>
        {layoutOpen && (
          <div className={`${PANEL_CLS} w-56`}>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('routeStyle')}</span>
                <Select
                  className="w-full"
                  value={routeMode}
                  options={routeOptions}
                  onChange={(value) => onRouteModeChange(value as ConnectorRouteMode)}
                  triggerClassName={COMPACT_SELECT_CLS}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('layoutDirection')}</span>
                <Select
                  className="w-full"
                  value={layoutDirection}
                  options={directionOptions}
                  onChange={(value) => onLayoutDirectionChange(value as AutoLayoutDirection)}
                  triggerClassName={COMPACT_SELECT_CLS}
                />
              </label>
              <Button
                variant="primary"
                tone="blue"
                size="sm"
                block
                className="gap-1.5"
                disabled={!canAutoLayout}
                onClick={onAutoLayout}
              >
                <LayoutGrid size={14} /> {t('autoLayout')}
              </Button>
              <p className="text-[11px] leading-relaxed text-gray-400">{t('autoLayoutTitle')}</p>
            </div>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-xs text-gray-400">
          {saveState === 'saving' ? t('saving') : saveState === 'dirty' ? t('unsaved') : t('saved')}
        </span>
        <Button variant="secondary" size="sm" className="gap-1.5" onClick={onExportPng}>
          <Image size={14} /> {t('exportPng')}
        </Button>
        <Button variant="secondary" size="sm" className="gap-1.5" onClick={onExportSvg}>
          <Download size={14} /> {t('exportSvg')}
        </Button>
        <Button variant="primary" tone="blue" size="sm" className="gap-1.5" onClick={onPresent}>
          ▶ {t('present')}
        </Button>
      </div>
    </div>
  )
}
