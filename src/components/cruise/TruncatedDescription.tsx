'use client'

import { useState } from 'react'

interface TruncatedDescriptionProps {
  html: string
  maxLength?: number
}

/** Strip HTML tags to get plain text length for truncation */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ')
}

export function TruncatedDescription({ html, maxLength = 500 }: TruncatedDescriptionProps) {
  const [expanded, setExpanded] = useState(false)
  const plainText = stripHtml(html)
  const needsTruncation = plainText.length > maxLength

  return (
    <div>
      <div
        className={`text-[var(--color-ink)] leading-relaxed text-base prose prose-sm max-w-none [&_p]:mb-4 [&_br]:block ${
          !expanded && needsTruncation ? 'max-h-[180px] overflow-hidden relative' : ''
        }`}
        style={!expanded && needsTruncation ? { WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)', maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)' } : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-2 font-avenir text-sm font-semibold text-[var(--color-primary)] hover:underline"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
