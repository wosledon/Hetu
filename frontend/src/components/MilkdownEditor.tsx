import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react'
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { nord } from '@milkdown/theme-nord'
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MilkdownPlugin } from '@milkdown/ctx'
import '@milkdown/theme-nord/style.css'

export interface SelectionInfo {
  text: string
  from: number
  to: number
  /** 浮窗应定位的相对容器坐标 */
  coords: { top: number; left: number } | null
  hasSelection: boolean
}

export interface MilkdownEditorHandle {
  getMarkdown: () => string
  setMarkdown: (md: string) => void
  replaceSelection: (text: string) => void
  appendContent: (text: string) => void
  getSelectionInfo: () => SelectionInfo
  focus: () => void
  /** 选中指定区间 [from, to) */
  selectRange: (from: number, to: number) => void
}

interface MilkdownEditorProps {
  /** 初始 markdown 值，仅在挂载和 noteId 变化时生效 */
  initialMarkdown: string
  /** 内容变化回调（返回最新 markdown 字符串） */
  onChange: (md: string) => void
  /** 选区变化回调 */
  onSelectionChange?: (info: SelectionInfo) => void
  /** 占位文字 */
  placeholder?: string
}

interface TrackedSelection {
  text: string
  from: number
  to: number
  hasSelection: boolean
}

const selectionPluginKey = new PluginKey<TrackedSelection | null>('hetu-selection-tracker')

/**
 * 监听 ProseMirror 选区变化的插件，在变化时通过回调通知宿主。
 * 同时把选区信息存到插件 state，供后续读取。
 */
function selectionTrackerPlugin(onChange?: (info: SelectionInfo) => void) {
  return $prose(() => {
    return new Plugin({
      key: selectionPluginKey,
      state: {
        init: () => null as TrackedSelection | null,
        apply: (tr, value, _oldState, newState): TrackedSelection | null => {
          // 只在选区或文档变化时计算
          if (!tr.selectionSet && !tr.docChanged) return value
          const { selection, doc } = newState
          if (selection.empty) return null
          const text = doc.textBetween(selection.from, selection.to, '\n')
          return {
            text,
            from: selection.from,
            to: selection.to,
            hasSelection: true,
          }
        },
      },
      view: () => ({
        update: (view: EditorView) => {
          if (!onChange) return
          const state = selectionPluginKey.getState(view.state)
          if (!state || !state.hasSelection) {
            onChange({ text: '', from: 0, to: 0, coords: null, hasSelection: false })
            return
          }
          // 计算选区末尾坐标，相对编辑器容器
          const containerRect = view.dom.getBoundingClientRect()
          const end = Math.max(state.from, state.to)
          const coords = view.coordsAtPos(end)
          onChange({
            text: state.text,
            from: state.from,
            to: state.to,
            coords: {
              top: coords.top - containerRect.top + 24, // 让浮窗位于选区下方一行
              left: Math.max(coords.left - containerRect.left, 0),
            },
            hasSelection: true,
          })
        },
      }),
    }) as Plugin
  })
}

/**
 * 监听文档变化并序列化为 markdown 字符串的插件。
 * 用 $prose 包装，这样可以用 ctx 拿到 serializer，避免重复注入。
 */
function markdownUpdatePlugin(onChange: (md: string) => void): MilkdownPlugin {
  return $prose((ctx) => {
    let lastDoc: EditorState['doc'] | null = null
    return new Plugin({
      key: new PluginKey('hetu-markdown-update'),
      view: () => ({
        update: (view: EditorView) => {
          // 只在文档实际变化时序列化
          if (lastDoc && view.state.doc.eq(lastDoc)) return
          lastDoc = view.state.doc
          // 在 update 中获取 serializer，此时 editor 已完全初始化
          const serializer = ctx.get(serializerCtx)
          const md = serializer(view.state.doc)
          onChange(md)
        },
      }),
    }) as Plugin
  })
}

const MilkdownEditorInner = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditorInner(props, ref) {
    const { initialMarkdown, onChange, onSelectionChange, placeholder } = props
    const onChangeRef = useRef(onChange)
    const onSelectionChangeRef = useRef(onSelectionChange)
    const initialMarkdownRef = useRef(initialMarkdown)
    const lastEmittedRef = useRef<string>(initialMarkdown)

    // 用 ref 承载最新的回调，避免每次回调变化都重建编辑器
    useEffect(() => {
      onChangeRef.current = onChange
      onSelectionChangeRef.current = onSelectionChange
    }, [onChange, onSelectionChange])

    const onMdChange = (md: string) => {
      if (md === lastEmittedRef.current) return
      lastEmittedRef.current = md
      onChangeRef.current?.(md)
    }
    const onSelChange = (info: SelectionInfo) => onSelectionChangeRef.current?.(info)
    const mdPlugin = markdownUpdatePlugin(onMdChange)
    const selPlugin = selectionTrackerPlugin(onSelChange)

    const editorInfo = useEditor((root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, initialMarkdownRef.current)
        })
        .config(nord)
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(mdPlugin)
        .use(selPlugin),
    )

    const [, getInstance] = useInstance()
    const getEditor = editorInfo.get

    /** 直接获取当前 markdown 字符串（不触发更新） */
    const getMarkdown = useCallback((): string => {
      const editor = getEditor() ?? getInstance()
      if (!editor) return ''
      const ctx = editor.ctx
      const serializer = ctx.get(serializerCtx)
      const view = ctx.get(editorViewCtx)
      return serializer(view.state.doc)
    }, [getEditor, getInstance])

    /** 用新 markdown 替换整个文档 */
    const setMarkdown = useCallback(
      (md: string) => {
        const editor = getEditor() ?? getInstance()
        if (!editor) return
        const ctx = editor.ctx
        const view = ctx.get(editorViewCtx)
        const parser = ctx.get(parserCtx)
        const doc = parser(md)
        if (!doc) return
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
        lastEmittedRef.current = md
      },
      [getEditor, getInstance],
    )

    /** 替换当前选区文本，替换后选中插入的新内容 */
    const replaceSelection = useCallback(
      (text: string) => {
        const editor = getEditor() ?? getInstance()
        if (!editor) return
        const ctx = editor.ctx
        const view = ctx.get(editorViewCtx)
        const { state } = view
        const tr = state.tr.replaceSelectionWith(state.schema.text(text))
        // 选中刚插入的文本
        const insertPos = state.selection.from
        tr.setSelection(TextSelection.create(tr.doc, insertPos, insertPos + text.length))
        view.dispatch(tr)
        // 触发一次 onChange 同步
        const md = getMarkdown()
        lastEmittedRef.current = md
        onChangeRef.current?.(md)
      },
      [getEditor, getInstance, getMarkdown],
    )

    /** 在文档末尾追加内容（用空行分隔） */
    const appendContent = useCallback(
      (text: string) => {
        const editor = getEditor() ?? getInstance()
        if (!editor) return
        const ctx = editor.ctx
        const view = ctx.get(editorViewCtx)
        const { state } = view
        const end = state.doc.content.size
        const lastChar = end > 0 ? state.doc.textBetween(Math.max(end - 1, 0), end, '\n') : ''
        const sep = lastChar.endsWith('\n') ? '\n' : '\n\n'
        const tr = state.tr.insertText(sep + text, end)
        view.dispatch(tr)
        const md = getMarkdown()
        lastEmittedRef.current = md
        onChangeRef.current?.(md)
      },
      [getEditor, getInstance, getMarkdown],
    )

    /** 读取当前选区信息（含相对坐标） */
    const getSelectionInfo = useCallback((): SelectionInfo => {
      const editor = getEditor() ?? getInstance()
      if (!editor) return { text: '', from: 0, to: 0, coords: null, hasSelection: false }
      const ctx = editor.ctx
      const view = ctx.get(editorViewCtx)
      const { selection, doc } = view.state
      if (selection.empty) {
        return { text: '', from: 0, to: 0, coords: null, hasSelection: false }
      }
      const text = doc.textBetween(selection.from, selection.to, '\n')
      const containerRect = view.dom.getBoundingClientRect()
      const end = Math.max(selection.from, selection.to)
      const coords = view.coordsAtPos(end)
      return {
        text,
        from: selection.from,
        to: selection.to,
        coords: {
          top: coords.top - containerRect.top + 24,
          left: Math.max(coords.left - containerRect.left, 0),
        },
        hasSelection: true,
      }
    }, [getEditor, getInstance])

    /** 聚焦编辑器 */
    const focus = useCallback(() => {
      const editor = getEditor() ?? getInstance()
      if (!editor) return
      const view = editor.ctx.get(editorViewCtx)
      view.focus()
    }, [getEditor, getInstance])

    /** 选中指定区间 */
    const selectRange = useCallback(
      (from: number, to: number) => {
        const editor = getEditor() ?? getInstance()
        if (!editor) return
        const view = editor.ctx.get(editorViewCtx)
        const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))
        view.dispatch(tr)
        view.focus()
      },
      [getEditor, getInstance],
    )

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown,
        setMarkdown,
        replaceSelection,
        appendContent,
        getSelectionInfo,
        focus,
        selectRange,
      }),
      [
        getMarkdown,
        setMarkdown,
        replaceSelection,
        appendContent,
        getSelectionInfo,
        focus,
        selectRange,
      ],
    )

    return (
      <div className="hetu-milkdown-root h-full w-full" data-placeholder={placeholder ?? ''}>
        <Milkdown />
      </div>
    )
  },
)

export const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditor(props, ref) {
    return (
      <MilkdownProvider>
        <MilkdownEditorInner {...props} ref={ref} />
      </MilkdownProvider>
    )
  },
)
