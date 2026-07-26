// 河图法阵 logo：与启动页同一套图形语言，小尺寸下做减法——
// 只保留虚线天轨 / 八边形阵基 / 太极核心，动效为双环缓转 + 巡轨光珠 + 太极脉冲。

const octPoints = '100,22 155.2,44.8 178,100 155.2,155.2 100,178 44.8,155.2 22,100 44.8,44.8'

export default function BrandMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
      className={className}
    >
      {/* 虚线天轨（缓转正） */}
      <g className="brandmark-spin-cw">
        <circle cx="100" cy="100" r="90" fill="none" stroke="var(--gold)" strokeWidth="3" strokeDasharray="3 12" strokeLinecap="round" />
      </g>
      {/* 八边形阵基（缓转反） */}
      <g className="brandmark-spin-rev">
        <polygon points={octPoints} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="3" />
      </g>
      {/* 巡轨光珠 */}
      <g className="brandmark-orb">
        <circle cx="100" cy="10" r="6.5" fill="var(--gold)" />
      </g>
      <g className="brandmark-orb2">
        <circle cx="100" cy="190" r="4.5" fill="var(--cyan)" />
      </g>
      {/* 太极核心 */}
      <g className="brandmark-taiji">
        <circle cx="100" cy="100" r="30" fill="none" stroke="var(--cyan)" strokeWidth="3.5" />
        <path
          d="M100,70 A30,30 0 0 1 100,130 A15,15 0 0 1 100,100 A15,15 0 0 0 100,70 Z"
          fill="var(--gold)"
        />
        <circle cx="100" cy="85" r="5" fill="var(--cyan)" />
      </g>
      {/* 脉冲环 */}
      <circle cx="100" cy="100" r="34" fill="none" stroke="var(--gold)" strokeWidth="2.5" className="brandmark-core" />
    </svg>
  )
}
