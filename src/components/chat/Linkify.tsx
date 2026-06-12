const URL_RE = /(https?:\/\/[^\s<>"']+)/g

/**
 * Renders plain text with URLs as clickable links — chat messages only.
 * Not a markdown renderer: just URLs, opened in a new tab. The availability
 * links the inbox sends would otherwise be dead text in the widget.
 */
export function Linkify({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        // Not URL_RE.test() — a /g regex keeps lastIndex state between calls
        // and would silently skip every other URL.
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={className ?? 'underline underline-offset-2 break-all hover:opacity-80'}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}
