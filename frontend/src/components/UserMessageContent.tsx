import CollapsedLongText, { PastedLongTextBlock } from './CollapsedLongText'
import ThemedMarkdown from './ThemedMarkdown'
import { splitLongTextBlock } from '../utils/longText'

/**
 * 用户消息正文：粘贴进来的长文本块单独折叠成一行，自己写的话照常渲染，
 * 两者都展开/折叠互不影响。没有标记的旧消息（或整条都很长的）退回整体折叠。
 */
export default function UserMessageContent({ content, className = '' }: { content: string; className?: string }) {
  const { block, label, rest } = splitLongTextBlock(content)

  if (!block) {
    return (
      <CollapsedLongText text={content} className={className}>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ThemedMarkdown source={content} />
        </div>
      </CollapsedLongText>
    )
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <PastedLongTextBlock text={block} label={label ?? ''} />
      {rest.trim().length > 0 && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ThemedMarkdown source={rest} />
        </div>
      )}
    </div>
  )
}
