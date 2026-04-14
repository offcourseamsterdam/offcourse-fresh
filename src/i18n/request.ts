import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import { Locale } from '@/lib/i18n/config'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale
  }

  // Load English as base, then merge locale-specific translations on top.
  // This ensures non-English locales fall back to English for untranslated strings.
  const enMessages = (await import('../lib/i18n/messages/en.json')).default
  let localeMessages: Record<string, unknown> = {}

  if (locale !== 'en') {
    try {
      const mod = await import(`../lib/i18n/messages/${locale}.json`)
      if (Object.keys(mod.default).length > 0) {
        localeMessages = mod.default
      }
    } catch {
      // Locale file not found — fall back to English entirely
    }
  }

  return {
    locale,
    messages: { ...enMessages, ...localeMessages },
  }
})
