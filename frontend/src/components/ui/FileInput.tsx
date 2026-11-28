import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export type FileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** 隐藏文件选择器：触发按钮由调用方提供（通过 ref 调 click），原生 input 不再散落各页 */
const FileInput = forwardRef<HTMLInputElement, FileInputProps>(function FileInput({ className, ...rest }, ref) {
  return <input ref={ref} type="file" className={cn('hidden', className)} {...rest} />
})

export default FileInput