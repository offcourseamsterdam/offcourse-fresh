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
        className={`text-[var(--color-ink)] leading-relaxed text-base prose prose-sm max-w-none [&_p]:mb-4 [&_br]:block [&_h3]:font-briston [&_h3]:text-xl [&_h3]:sm:text-2xl [&_h3]:text-[var(--color-primary)] [&_h3]:mt-6 [&_h3]:mb-2 [&_h3:first-child]:mt-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_li]:mb-1.5 ${
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
