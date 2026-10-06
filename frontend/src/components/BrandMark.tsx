// 品牌图标：使用 frontend/public/brand.png 图片资产（Tauri 窗口/托盘图标与首屏同源）
export default function BrandMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  )
}
