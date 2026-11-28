import { cn } from '../../utils/cn'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** 无障碍名称 */
  label: string
  disabled?: boolean
  className?: string
}

/** 统一开关：role=switch、轨道与滑块尺寸、聚焦环只在这里维护 */
export default function Switch({ checked, onChange, label, disabled = false, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-900',
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}