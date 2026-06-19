interface HighlightTextProps {
  text: string
  keyword: string
  className?: string
}

export default function HighlightText({ text, keyword, className = '' }: HighlightTextProps) {
  if (!keyword.trim()) {
    return <span className={className}>{text}</span>
  }

  const lowerKeyword = keyword.toLowerCase()
  const segments: { text: string; isMatch: boolean }[] = []
  let remaining = text
  let index = 0

  while (remaining.length > 0) {
    const matchIndex = remaining.toLowerCase().indexOf(lowerKeyword)
    if (matchIndex === -1) {
      segments.push({ text: remaining, isMatch: false })
      break
    }
    if (matchIndex > 0) {
      segments.push({ text: remaining.slice(0, matchIndex), isMatch: false })
    }
    segments.push({ text: remaining.slice(matchIndex, matchIndex + keyword.length), isMatch: true })
    remaining = remaining.slice(matchIndex + keyword.length)
    index += 1
    if (index > 1000) break
  }

  return (
    <span className={className}>
      {segments.map((segment, i) =>
        segment.isMatch ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-700/50 text-inherit rounded px-0.5"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </span>
  )
}
