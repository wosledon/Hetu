// 品牌图标：Ht 连写字标（SVG 矢量，挂载时逐笔显现、之后仅星芒呼吸）
// 同一套笔画另有：brand.svg（静图）、ht-monogram-animated.svg（加载循环版）、
// ht-icon-animated.svg / ht-icon.svg（带底板版，用于桌面端启动屏与托盘/安装器图标）
export default function BrandMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand-animated.svg"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  )
}
