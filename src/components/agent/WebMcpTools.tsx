'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSearch } from '@/lib/search/SearchContext'
import { buildWebMcpTools, resolveLocaleFromPathname } from '@/lib/webmcp/build-tools'
import { getModelContext } from '@/lib/webmcp/types'

/**
 * Registers this site's WebMCP tools (search, cruise detail lookup,
 * navigation) with the browser's in-page agent, per
 * https://webmachinelearning.github.io/webmcp/. No-ops entirely in any
 * browser that doesn't implement the API yet — this is a very new,
 * Chrome-origin-trial-only feature (see src/lib/webmcp/types.ts). Renders
 * nothing; mounted once in the locale layout, inside <SearchProvider>.
 */
export function WebMcpTools() {
  const router = useRouter()
  const pathname = usePathname()
  const { triggerHomepageSearch } = useSearch()

  useEffect(() => {
    const modelContext = getModelContext()
    if (!modelContext) return

    const controller = new AbortController()
    const locale = resolveLocaleFromPathname(pathname)
    const tools = buildWebMcpTools({
      locale,
      triggerHomepageSearch,
      navigate: (url) => router.push(url),
    })

    for (const tool of tools) {
      void modelContext.registerTool(tool, { signal: controller.signal })
    }

    return () => controller.abort()
  }, [pathname, router, triggerHomepageSearch])

  return null
}
