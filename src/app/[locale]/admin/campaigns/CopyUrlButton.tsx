'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyUrlButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)
  const url = `https://offcourseamsterdam.com/t/${slug}`

  function handleCopy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy() }}
      title={url}
      className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}
