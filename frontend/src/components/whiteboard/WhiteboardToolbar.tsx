import { useTranslation } from 'react-i18next'
import {
  Circle, Copy, Diamond, Download, Eraser, Focus, Grid3x3, Hand, Image, LayoutGrid, Maximize,
  MousePointer2, PenLine, Redo2, Route as RouteIcon, Square, Trash2, Type, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import type { ConnectorRouteMode, IWhiteboardStyle, WhiteboardTool } from '../../types/whiteboard'
import { FILL_COLORS, STROKE_COLORS, type AutoLayoutDirection } from '../../utils/whiteboard'
import { Button, IconButton } from '../ui'

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

/** 白板工具栏：工具 / 样式 / 视图 / 历史 / 导出 / 演示 */
export default function WhiteboardToolbar({
  tool, onToolChange, style, onStyleChange, snap, onSnapChange,
  zoom, onZoomIn, onZoomOut, onZoomReset, onZoomFit,
  canUndo, canRedo, onUndo, onRedo, onDelete, onDuplicate,
  onExportPng, onExportSvg, onPresent, saveState, hasSelection,
  layoutDirection, onLayoutDirectionChange, onAutoLayout, canAutoLayout,
  routeMode, onRouteModeChange,
}: WhiteboardToolbarProps) {
  const { t } = useTranslation('whiteboard')

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-gray-200 bg-white glass px-3 py-2 dark:border-white/[0.08] dark:bg-gray-900/50">
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

      <div className="flex items-center gap-1.5" title={t('styleTitle')}>
        <div className="flex items-center gap-0.5">
          {STROKE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={t('strokeColor')}
              title={t('strokeColor')}
              onClick={() => onStyleChange({ ...style, stroke: color })}
              className={`h-4 w-4 rounded-full border border-black/10 transition-transform hover:scale-110 ${style.stroke === color ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-900' : ''}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          {FILL_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={t('fillColor')}
              title={t('fillColor')}
              onClick={() => onStyleChange({ ...style, fill: color })}
              className={`h-4 w-4 rounded border border-black/10 transition-transform hover:scale-110 ${style.fill === color ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-900' : ''}`}
              style={color === 'transparent'
                ? { backgroundImage: 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)' }
                : { backgroundColor: color }}
            />
          ))}
        </div>
        <select
          aria-label={t('strokeWidth')}
          title={t('strokeWidth')}
          value={style.strokeWidth}
          onChange={(event) => onStyleChange({ ...style, strokeWidth: Number(event.target.value) })}
          className="rounded-md border border-gray-200 bg-gray-50 px-1 py-0.5 text-xs text-gray-600 outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
        >
          {STROKE_WIDTHS.map((width) => (
            <option key={width} value={width}>{width}px</option>
          ))}
        </select>
        <select
          aria-label={t('fontSize')}
          title={t('fontSize')}
          value={style.fontSize}
          onChange={(event) => onStyleChange({ ...style, fontSize: Number(event.target.value) })}
          className="rounded-md border border-gray-200 bg-gray-50 px-1 py-0.5 text-xs text-gray-600 outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>{size}px</option>
          ))}
        </select>
      </div>

      <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-white/10" />

      <div className="flex items-center gap-1" title={t('autoLayoutTitle')}>
        <select
          aria-label={t('routeStyle')}
          title={t('routeStyle')}
          value={routeMode}
          onChange={(event) => onRouteModeChange(event.target.value as ConnectorRouteMode)}
          className="rounded-md border border-gray-200 bg-gray-50 px-1 py-0.5 text-xs text-gray-600 outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
        >
          <option value="orthogonal">{t('routeOrthogonal')}</option>
          <option value="straight">{t('routeStraight')}</option>
        </select>
        <select
          aria-label={t('layoutDirection')}
          title={t('layoutDirection')}
          value={layoutDirection}
          onChange={(event) => onLayoutDirectionChange(event.target.value as AutoLayoutDirection)}
          className="rounded-md border border-gray-200 bg-gray-50 px-1 py-0.5 text-xs text-gray-600 outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
        >
          <option value="LR">{t('layoutLR')}</option>
          <option value="TB">{t('layoutTB')}</option>
        </select>
        <Button variant="secondary" size="sm" className="gap-1.5" disabled={!canAutoLayout} onClick={onAutoLayout}>
          <LayoutGrid size={14} /> {t('autoLayout')}
        </Button>
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
