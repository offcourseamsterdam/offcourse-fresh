/**
 * Bot detection by User-Agent string.
 * Prevents crawlers, SEO tools, and uptime monitors from inflating analytics.
 */

const BOT_PATTERNS = [
  // Search engine crawlers
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
  'yandexbot', 'applebot', 'petalbot', 'bytespider',
  // Social media preview crawlers
  'facebookexternalhit', 'twitterbot', 'linkedinbot',
  'whatsapp', 'telegrambot', 'slackbot', 'discordbot',
  // SEO tools
  'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'rogerbot',
  'screaming frog', 'seositecheckup',
  // AI crawlers
  'gptbot', 'claudebot', 'chatgpt', 'anthropic',
  // Monitoring & testing
  'uptimerobot', 'pingdom', 'gtmetrix', 'lighthouse',
  'pagespeed', 'webpagetest',
  // Headless browsers (usually bots)
  'headlesschrome', 'phantomjs', 'puppeteer',
  // Generic bot indicators
  'scraper',
]

/**
 * Returns true if the User-Agent looks like a bot/crawler.
 * Check is case-insensitive.
 */
export function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return BOT_PATTERNS.some((pattern) => ua.includes(pattern))
}
