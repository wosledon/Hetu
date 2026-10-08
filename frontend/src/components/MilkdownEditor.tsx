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
import { codeBlockComponent, codeBlockConfig } from '@milkdown/kit/component/code-block'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Slice as ProseSlice } from '@milkdown/kit/prose/model'
import type { MilkdownPlugin } from '@milkdown/ctx'
import { callCommand } from '@milkdown/utils'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  insertHrCommand,
  setBlockTypeCommand,
} from '@milkdown/preset-commonmark'
import { toggleStrikethroughCommand, insertTableCommand } from '@milkdown/preset-gfm'
import { mermaidConfigCtx } from '@milkdown/plugin-diagram'
import { mermaidConfig, isDarkTheme, fitMermaidLabels } from '../utils/mermaidTheme'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, indentUnit } from '@codemirror/language'
import { EditorView as CMEditorView } from '@codemirror/view'
import { math } from '@milkdown/plugin-math'
import { emoji } from '@milkdown/plugin-emoji'
import { diagram } from '@milkdown/plugin-diagram'
import '@milkdown/theme-nord/style.css'

/** 流程图节点默认模板 */
const MERMAID_TEMPLATE = 'graph TD\n    A[开始] --> B[结束]'

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
  /** 在光标处插入 markdown（自动解析为块级节点） */
  insertMarkdown: (md: string) => void
  /** 在光标处插入纯文本（触发输入规则，如 "- [ ] " 转待办） */
  insertText: (text: string) => void
  /** 插入 mermaid 流程图块 */
  insertDiagram: () => void
  /** 格式命令（供浮动工具栏调用） */
  toggleBold: () => void
  toggleItalic: () => void
  toggleStrikethrough: () => void
  toggleInlineCode: () => void
  toggleHeading: (level: number) => void
  toggleParagraph: () => void
  toggleBlockquote: () => void
  toggleBulletList: () => void
  toggleOrderedList: () => void
  toggleTodo: () => void
  insertCodeBlock: () => void
  insertDivider: () => void
  insertTable: () => void
  insertLink: (href: string) => void
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
 * 流程图（mermaid）节点视图：
 * - 预览态渲染 SVG，失败时回退展示源码与错误提示
 * - 点击进入编辑态（多行文本框），失焦后保存并重新渲染
 */
class DiagramNodeView {
  dom: HTMLElement
  private node: ProseNode
  private view: EditorView
  private getPos: () => number
  private editing = false
  private renderToken = 0

  constructor(node: ProseNode, view: EditorView, getPos: () => number) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = document.createElement('div')
    this.dom.className = 'hetu-diagram'
    this.dom.addEventListener('click', this.handleClick)
    this.renderPreview()
  }

  private handleClick = () => {
    if (this.editing) return
    this.editing = true
    this.renderEditor()
  }

  private renderEditor() {
    this.renderToken += 1
    this.dom.innerHTML = ''
    this.dom.classList.add('hetu-diagram-editing')
    const textarea = document.createElement('textarea')
    textarea.value = this.node.attrs.value || MERMAID_TEMPLATE
    textarea.className = 'hetu-diagram-source'
    textarea.rows = Math.min(20, textarea.value.split('\n').length + 2)
    textarea.addEventListener('blur', () => this.commit(textarea.value))
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') textarea.blur()
    })
    this.dom.appendChild(textarea)
    requestAnimationFrame(() => { textarea.focus(); textarea.select() })
  }

  private commit(value: string) {
    this.editing = false
    if (value !== (this.node.attrs.value || '')) {
      const pos = this.getPos()
      if (typeof pos === 'number') {
        const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          value,
        })
        this.view.dispatch(tr)
        return
      }
    }
    this.renderPreview()
  }

  private async renderPreview() {
    const token = ++this.renderToken
    this.dom.classList.remove('hetu-diagram-editing')
    const code = (this.node.attrs.value || '').trim()
    this.dom.innerHTML = ''
    if (!code) {
      this.dom.appendChild(this.buildHint('空流程图，点击编辑'))
      return
    }
    const loading = this.buildHint('流程图渲染中...')
    this.dom.appendChild(loading)
    try {
      const mermaid = (await import('mermaid')).default
      mermaid.initialize(mermaidConfig(isDarkTheme()))
      const { svg } = await mermaid.render(`hetu-diagram-${Date.now()}-${Math.random().toString(36).slice(2)}`, code)
      if (token !== this.renderToken) return
      this.dom.innerHTML = ''
      const holder = document.createElement('div')
      holder.className = 'hetu-diagram-svg'
      holder.innerHTML = svg
      this.dom.appendChild(holder)
      fitMermaidLabels(holder)
      this.dom.appendChild(this.buildHint('点击编辑流程图'))
    } catch (err) {
      if (token !== this.renderToken) return
      this.dom.innerHTML = ''
      const box = document.createElement('div')
      box.className = 'hetu-diagram-error'
      const msg = document.createElement('div')
      msg.className = 'hetu-diagram-error-msg'
      msg.textContent = `流程图语法错误：${err instanceof Error ? err.message.split('\n')[0] : String(err)}`
      const src = document.createElement('pre')
      src.textContent = code
      box.append(msg, src)
      this.dom.appendChild(box)
      this.dom.appendChild(this.buildHint('点击编辑修正'))
    }
  }

  private buildHint(text: string): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'hetu-diagram-hint'
    hint.textContent = text
    return hint
  }

  /** 外部节点更新（如撤销/重做）后同步 */
  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.editing) this.renderPreview()
    return true
  }

  /** 编辑器内交互全部交给节点视图自身处理 */
  stopEvent(): boolean {
    return true
  }

  destroy() {
    this.dom.removeEventListener('click', this.handleClick)
    this.renderToken += 1
  }
}

/** 注册流程图节点视图：插件默认只输出纯文本 div，这里替换为可渲染/可编辑的视图 */
function diagramNodeViewPlugin(): MilkdownPlugin {
  return $prose(() => {
    return new Plugin({
      key: new PluginKey('hetu-diagram-view'),
      props: {
        nodeViews: {
          diagram: (node, view, getPos) =>
            new DiagramNodeView(node, view, getPos as () => number),
        },
      },
    })
  })
}

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
          const start = Math.min(state.from, state.to)
          const endCoords = view.coordsAtPos(end)
          const startCoords = view.coordsAtPos(start)
          // 浮窗宽度 320px (w-80)，夹紧 left 防止溢出右侧
          const popupWidth = 320
          const left = Math.min(
            Math.max(endCoords.left - containerRect.left, 0),
            containerRect.width - popupWidth - 16
          )
          // 放在选区下方：取选区底部坐标 + 行高偏移
          const selectionBottom = Math.max(endCoords.bottom, startCoords.bottom)
          onChange({
            text: state.text,
            from: state.from,
            to: state.to,
            coords: {
              top: selectionBottom - containerRect.top + 8,
              left,
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

/**
 * 代码块后自动补段落插件。
 * 当文档末尾是 code_block 时，自动追加一个空段落，
 * 方便用户在代码块下方继续编写普通文本。
 * 仅在文档末尾生效，避免在已有内容之间插入多余空行。
 */
function autoParagraphAfterCodeBlockPlugin(): MilkdownPlugin {
  return $prose(() => {
    return new Plugin({
      key: new PluginKey('hetu-auto-paragraph-after-code'),
      appendTransaction: (trs, _oldState, newState) => {
        // 只在有文档变化的 transaction 上触发
        if (!trs.some((tr) => tr.docChanged)) return null
        const { doc, schema } = newState
        const lastChild = doc.lastChild
        if (!lastChild) return null
        // 仅在末尾是 code_block 时补一个空段落
        if (lastChild.type.name !== 'code_block') return null
        const tr = newState.tr
        const paragraph = schema.nodes.paragraph.create()
        tr.insert(doc.content.size, paragraph)
        return tr
      },
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
    const autoParagraphPlugin = autoParagraphAfterCodeBlockPlugin()

    const editorInfo = useEditor((root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, initialMarkdownRef.current)
          // 流程图主题跟随明暗模式
          ctx.update(mermaidConfigCtx.key, (config) => ({
            ...config,
            startOnLoad: false,
            securityLevel: 'loose',
          }))
        })
        .config(nord)
        .config((ctx) =>
          ctx.update(codeBlockConfig.key, (config) => ({
            ...config,
            languages,
            // 语法高亮 + Fira Code 字体 + 基础编辑体验
            extensions: [
              syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
              indentUnit.of('  '),
              CMEditorView.lineWrapping,
            ],
            // 用 SVG 图标替换默认 emoji
            copyIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
            copyText: '',
            expandIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
            searchIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
            clearSearchIcon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
          })),
        )
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(math)
        .use(emoji)
        .use(diagram)
        .use(diagramNodeViewPlugin())
        .use(mdPlugin)
        .use(selPlugin)
        .use(autoParagraphPlugin)
        .use(codeBlockComponent),
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
        // 按 markdown 解析替换内容：保留段落/标题/列表等结构
        const doc = ctx.get(parserCtx)(text)
        if (!doc) return
        const slice = new ProseSlice(doc.content, 0, 0)
        const { selection } = view.state
        const tr = view.state.tr
        if (selection.empty) {
          tr.replaceSelection(slice)
        } else {
          // 扩展到选区首尾所在的整个块再做替换：
          // 直接在标题内替换块级内容会被 PM 整段塞进标题，导致“全都变成标题”
          const $from = selection.$from
          const $to = selection.$to
          tr.replaceRange($from.before($from.depth), $to.after($to.depth), slice)
        }
        view.dispatch(tr)
        view.focus()
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

    /** 通用命令执行：传入 preset 导出的命令对象（携带 commandsCtx key） */
    const runCommand = useCallback(
      (command: { key: unknown }, payload?: unknown) => {
        const editor = getEditor() ?? getInstance()
        if (!editor) return
        editor.action(callCommand(command.key as string, payload))
      },
      [getEditor, getInstance],
    )

    /** 在光标处插入 markdown（解析为块级节点，替换当前空段落/选区） */
    const insertMarkdown = useCallback(
      (md: string) => {
        const editor = getEditor() ?? getInstance()
        if (!editor) return
        const ctx = editor.ctx
        const view = ctx.get(editorViewCtx)
        const doc = ctx.get(parserCtx)(md)
        if (!doc) return
        const tr = view.state.tr.replaceSelection(new ProseSlice(doc.content, 0, 0))
        view.dispatch(tr)
        view.focus()
        const serialized = ctx.get(serializerCtx)(view.state.doc)
        lastEmittedRef.current = serialized
        onChangeRef.current?.(serialized)
      },
      [getEditor, getInstance],
    )

    /** 在光标处插入纯文本（输入规则可将其转换为结构化节点） */
    const insertText = useCallback(
      (text: string) => {
        const editor = getEditor() ?? getInstance()
        if (!editor) return
        const view = editor.ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.insertText(text))
        view.focus()
        const ctx = editor.ctx
        const serialized = ctx.get(serializerCtx)(view.state.doc)
        lastEmittedRef.current = serialized
        onChangeRef.current?.(serialized)
      },
      [getEditor, getInstance],
    )

    /** 插入 mermaid 流程图块 */
    const insertDiagram = useCallback(() => {
      insertMarkdown(`\`\`\`mermaid\n${MERMAID_TEMPLATE}\n\`\`\``)
    }, [insertMarkdown])

    const toggleBold = useCallback(() => runCommand(toggleStrongCommand), [runCommand])
    const toggleItalic = useCallback(() => runCommand(toggleEmphasisCommand), [runCommand])
    const toggleStrikethrough = useCallback(() => runCommand(toggleStrikethroughCommand), [runCommand])
    const toggleInlineCode = useCallback(() => runCommand(toggleInlineCodeCommand), [runCommand])
    const toggleHeading = useCallback(
      (level: number) =>
        runCommand(setBlockTypeCommand, { nodeType: 'heading', attrs: { level } }),
      [runCommand],
    )
    const toggleParagraph = useCallback(
      () => runCommand(setBlockTypeCommand, { nodeType: 'paragraph' }),
      [runCommand],
    )
    const toggleBlockquote = useCallback(() => runCommand(wrapInBlockquoteCommand), [runCommand])
    const toggleBulletList = useCallback(() => runCommand(wrapInBulletListCommand), [runCommand])
    const toggleOrderedList = useCallback(() => runCommand(wrapInOrderedListCommand), [runCommand])
    const toggleTodo = useCallback(() => {
      // 先确保是列表项，再插入 "[ ] " 触发任务列表输入规则
      runCommand(wrapInBulletListCommand)
      insertText('[ ] ')
    }, [runCommand, insertText])
    const insertCodeBlock = useCallback(() => runCommand(createCodeBlockCommand), [runCommand])
    const insertDivider = useCallback(() => runCommand(insertHrCommand), [runCommand])
    const insertTable = useCallback(
      () => runCommand(insertTableCommand, { row: 3, col: 3 }),
      [runCommand],
    )
    const insertLink = useCallback(
      (href: string) => runCommand(toggleLinkCommand, { href }),
      [runCommand],
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
        insertMarkdown,
        insertText,
        insertDiagram,
        toggleBold,
        toggleItalic,
        toggleStrikethrough,
        toggleInlineCode,
        toggleHeading,
        toggleParagraph,
        toggleBlockquote,
        toggleBulletList,
        toggleOrderedList,
        toggleTodo,
        insertCodeBlock,
        insertDivider,
        insertTable,
        insertLink,
      }),
      [
        getMarkdown,
        setMarkdown,
        replaceSelection,
        appendContent,
        getSelectionInfo,
        focus,
        selectRange,
        insertMarkdown,
        insertText,
        insertDiagram,
        toggleBold,
        toggleItalic,
        toggleStrikethrough,
        toggleInlineCode,
        toggleHeading,
        toggleParagraph,
        toggleBlockquote,
        toggleBulletList,
        toggleOrderedList,
        toggleTodo,
        insertCodeBlock,
        insertDivider,
        insertTable,
        insertLink,
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
