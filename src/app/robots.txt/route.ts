const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

const PROTECTED = ['/admin/', '/api/', '/partners/', '/captain/', '/finance/', '/account/']

// Belt-and-suspenders: some bots only respect a rule that names them specifically.
const AI_SEARCH_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'PerplexityBot',
  'ClaudeBot',
  'Applebot-Extended',
  'cohere-ai',
  'Diffbot',
]

// contentsignals.org: declares our AI-use preferences (search indexing, AI
// grounding/citation, and model training) since Next's built-in robots()
// metadata API (MetadataRoute.Robots) has no field for this directive.
const CONTENT_SIGNAL = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes'

export function GET() {
  const lines = [
    'User-Agent: *',
    CONTENT_SIGNAL,
    'Allow: /',
    ...PROTECTED.map((path) => `Disallow: ${path}`),
    '',
    ...AI_SEARCH_BOTS.map((agent) => `User-Agent: ${agent}`),
    CONTENT_SIGNAL,
    'Allow: /',
    'Allow: /llms.txt',
    'Allow: /llms-full.txt',
    ...PROTECTED.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${BASE_URL}/sitemap.xml`,
  ]

  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain' },
  })
}
