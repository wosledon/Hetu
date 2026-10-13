import { Search } from 'lucide-react'
import Input, { type InputProps } from './Input'

export type SearchInputProps = Omit<InputProps, 'icon'>

/** 带放大镜图标的搜索输入框 */
export default function SearchInput({ size = 'md', ...rest }: SearchInputProps) {
  return <Input {...rest} size={size} icon={<Search size={size === 'sm' ? 13 : 14} />} />
}
