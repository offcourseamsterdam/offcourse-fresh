import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

const PROTECTED = ['/admin/', '/api/', '/partners/', '/captain/', '/finance/', '/account/']

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default: allow all crawlers, protect internal routes
      {
        userAgent: '*',
        allow: '/',
        disallow: PROTECTED,
      },
      // Explicitly welcome AI search bots on all public content + LLM endpoints.
      // Belt-and-suspenders: some bots only respect a rule that names them specifically.
      {
        userAgent: [
          'GPTBot',
          'OAI-SearchBot',
          'PerplexityBot',
          'ClaudeBot',
          'Applebot-Extended',
          'cohere-ai',
          'Diffbot',
        ],
        allow: ['/', '/llms.txt', '/llms-full.txt'],
        disallow: PROTECTED,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
