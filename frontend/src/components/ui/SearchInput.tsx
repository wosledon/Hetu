import { forwardRef } from 'react'
import { Search } from 'lucide-react'
import Input, { type InputProps } from './Input'

export type SearchInputProps = Omit<InputProps, 'icon' | 'glass' | 'pill'>

/**
 * 全站统一的搜索框：玻璃胶囊（glass + pill）+ 放大镜图标插槽。
 * 图标定位与左内边距由 Input 的 icon 插槽按 size 自动处理，
 * 调用方只传布局类（w-full / w-56 等）与输入逻辑，不再手写样式。
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { size = 'md', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      {...rest}
      size={size}
      glass
      pill
      icon={<Search size={size === 'lg' ? 15 : size === 'sm' ? 13 : 14} />}
    />
  )
})

export default SearchInput
