import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildWebMcpTools, resolveLocaleFromPathname } from './build-tools'

function findTool(tools: ReturnType<typeof buildWebMcpTools>, name: string) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool "${name}" not found`)
  return tool
}

describe('resolveLocaleFromPathname', () => {
  it('extracts a supported locale prefix', () => {
    expect(resolveLocaleFromPathname('/nl/cruises/sunset')).toBe('nl')
    expect(resolveLocaleFromPathname('/en')).toBe('en')
  })

  it('defaults to en for an unsupported or missing prefix', () => {
    expect(resolveLocaleFromPathname('/xx/cruises')).toBe('en')
    expect(resolveLocaleFromPathname('/')).toBe('en')
  })
})

describe('buildWebMcpTools', () => {
  const triggerHomepageSearch = vi.fn()
  const navigate = vi.fn()
  let fetchImpl: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchImpl = vi.fn()
  })

  const deps = () => ({ locale: 'en' as const, triggerHomepageSearch, navigate, fetchImpl: fetchImpl as unknown as typeof fetch })

  it('exposes exactly the three documented tools with name, description, and inputSchema', () => {
    const tools = buildWebMcpTools(deps())
    expect(tools.map((t) => t.name)).toEqual(['search_cruises', 'get_cruise_details', 'navigate_to_cruise'])
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeTruthy()
    }
  })

  describe('search_cruises', () => {
    it('triggers the real homepage search and returns a summarized result', async () => {
      fetchImpl.mockResolvedValue({
        json: async () => ({
          ok: true,
          data: { results: [{ listing: { slug: 'sunset', title: 'Sunset Cruise', price_display: '€35' }, availableSlots: [1, 2] }] },
        }),
      })
      const tool = findTool(buildWebMcpTools(deps()), 'search_cruises')
      const result = await tool.execute({ date: '2026-07-04', guests: 4 }, {})

      expect(triggerHomepageSearch).toHaveBeenCalledWith('2026-07-04', 4)
      expect(fetchImpl).toHaveBeenCalledWith('/api/search?date=2026-07-04&guests=4', { signal: undefined })
      expect(result).toEqual({
        date: '2026-07-04',
        guests: 4,
        cruises: [{ slug: 'sunset', title: 'Sunset Cruise', price_display: '€35', available_slot_count: 2 }],
      })
    })

    it('defaults guests to 2 when omitted', async () => {
      fetchImpl.mockResolvedValue({ json: async () => ({ ok: true, data: { results: [] } }) })
      const tool = findTool(buildWebMcpTools(deps()), 'search_cruises')
      await tool.execute({ date: '2026-07-04' }, {})
      expect(triggerHomepageSearch).toHaveBeenCalledWith('2026-07-04', 2)
    })

    it('rejects a malformed date without calling fetch or triggering a search', async () => {
      const tool = findTool(buildWebMcpTools(deps()), 'search_cruises')
      const result = await tool.execute({ date: 'not-a-date' }, {})
      expect(result).toEqual({ error: '"date" is required and must be YYYY-MM-DD' })
      expect(triggerHomepageSearch).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('surfaces an API-level error', async () => {
      fetchImpl.mockResolvedValue({ json: async () => ({ ok: false, error: 'boom' }) })
      const tool = findTool(buildWebMcpTools(deps()), 'search_cruises')
      const result = await tool.execute({ date: '2026-07-04' }, {})
      expect(result).toEqual({ error: 'boom' })
    })
  })

  describe('get_cruise_details', () => {
    it('fetches the public cruise detail API for the given locale', async () => {
      fetchImpl.mockResolvedValue({ json: async () => ({ ok: true, data: { slug: 'sunset', title: 'Sunset Cruise' } }) })
      const tool = findTool(buildWebMcpTools({ ...deps(), locale: 'nl' }), 'get_cruise_details')
      const result = await tool.execute({ slug: 'sunset' }, {})
      expect(fetchImpl).toHaveBeenCalledWith('/api/v1/cruises/sunset?locale=nl', { signal: undefined })
      expect(result).toEqual({ slug: 'sunset', title: 'Sunset Cruise' })
    })

    it('rejects a missing slug without calling fetch', async () => {
      const tool = findTool(buildWebMcpTools(deps()), 'get_cruise_details')
      const result = await tool.execute({}, {})
      expect(result).toEqual({ error: '"slug" is required' })
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })

  describe('navigate_to_cruise', () => {
    it('navigates to the cruise page with date and guests as query params', () => {
      const tool = findTool(buildWebMcpTools(deps()), 'navigate_to_cruise')
      const result = tool.execute({ slug: 'sunset', date: '2026-07-04', guests: 4 }, {})
      expect(navigate).toHaveBeenCalledWith('/en/cruises/sunset?date=2026-07-04&guests=4')
      expect(result).toEqual({ navigated: true, url: '/en/cruises/sunset?date=2026-07-04&guests=4' })
    })

    it('navigates with no query string when date/guests are omitted', () => {
      const tool = findTool(buildWebMcpTools(deps()), 'navigate_to_cruise')
      tool.execute({ slug: 'sunset' }, {})
      expect(navigate).toHaveBeenCalledWith('/en/cruises/sunset')
    })

    it('rejects a missing slug without navigating', () => {
      const tool = findTool(buildWebMcpTools(deps()), 'navigate_to_cruise')
      const result = tool.execute({}, {})
      expect(result).toEqual({ error: '"slug" is required' })
      expect(navigate).not.toHaveBeenCalled()
    })
  })
})
