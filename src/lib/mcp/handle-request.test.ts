import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMcpRequest, PROTOCOL_VERSION } from './handle-request'
import { SkillInputError } from '@/lib/a2a/skills'

const h = vi.hoisted(() => ({ runSkill: vi.fn() }))
vi.mock('@/lib/a2a/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a2a/skills')>()
  return { ...actual, runSkill: h.runSkill }
})

describe('handleMcpRequest — protocol basics', () => {
  it('returns null (no response) for a notification with no id', async () => {
    expect(await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('returns an error for a malformed request that does have an id', async () => {
    const res = await handleMcpRequest({ jsonrpc: '1.0', method: 'initialize', id: 1 })
    expect(res?.error?.code).toBe(-32600)
  })

  it('returns METHOD_NOT_FOUND for an unrecognized method', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'bogus/method', id: 1 })
    expect(res?.error?.code).toBe(-32601)
  })

  it('responds to ping with an empty result', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'ping', id: 1 })
    expect(res?.result).toEqual({})
  })
})

describe('handleMcpRequest — initialize', () => {
  it('always responds with this server\'s protocol version and tools capability', async () => {
    const res = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      id: 1,
    })
    const result = res?.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } }
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(result.capabilities).toEqual({ tools: {} })
    expect(result.serverInfo.name).toBe('Off Course Amsterdam')
  })

  it('notes the version mismatch in instructions when the client requests a different version', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05' }, id: 1 })
    const result = res?.result as { instructions: string }
    expect(result.instructions).toContain(PROTOCOL_VERSION)
  })
})

describe('handleMcpRequest — tools/list', () => {
  it('lists both tools with name, description, and inputSchema', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    const { tools } = res?.result as { tools: Array<{ name: string }> }
    expect(tools.map((t) => t.name)).toEqual(['list_cruises', 'check_availability'])
  })
})

describe('handleMcpRequest — tools/call', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the named tool and returns its JSON result as a text content block', async () => {
    h.runSkill.mockResolvedValue({ cruises: [] })
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_cruises', arguments: {} }, id: 1 })
    expect(h.runSkill).toHaveBeenCalledWith('list_cruises', {})
    const result = res?.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ cruises: [] })
  })

  it('returns isError:true (not a JSON-RPC error) for an unknown tool name', async () => {
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'book_a_cruise', arguments: {} }, id: 1 })
    expect(res?.error).toBeUndefined()
    const result = res?.result as { isError?: boolean }
    expect(result.isError).toBe(true)
  })

  it('returns isError:true for a SkillInputError, carrying its message', async () => {
    h.runSkill.mockRejectedValue(new SkillInputError('bad date'))
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'check_availability', arguments: {} }, id: 1 })
    const result = res?.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('bad date')
  })

  it('returns isError:true (never a thrown exception) for an unexpected failure', async () => {
    h.runSkill.mockRejectedValue(new Error('supabase down'))
    const res = await handleMcpRequest({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_cruises', arguments: {} }, id: 1 })
    const result = res?.result as { isError?: boolean }
    expect(result.isError).toBe(true)
  })
})
