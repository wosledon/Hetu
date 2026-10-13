// 品牌图标：Ht 连写字标（SVG 矢量）
// 用静图 brand.svg 而不是 brand-animated.svg：导航栏随路由整体重挂载，动画版的
// 「逐笔绘入」每次切换页面都会重画一遍，星芒还会 4.5s 无限呼吸——在常驻界面里
// 看起来就是闪烁。动画版只留给一次性入场（关于页 / 启动屏）。
// 同一套笔画另有：brand.svg（静图）、brand-animated.svg（绘一次后星芒呼吸）、
// ht-monogram-animated.svg（加载循环版）、ht-icon-animated.svg / ht-icon.svg
//（带底板版，用于桌面端启动屏与托盘/安装器图标）
export default function BrandMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand.svg"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none object-contain ${className}`}
    />
  )
}
