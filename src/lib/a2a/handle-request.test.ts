import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleJsonRpcRequest } from './handle-request'
import { getTask } from './task-store'
import { SkillInputError } from './skills'

const h = vi.hoisted(() => ({ runSkill: vi.fn() }))
vi.mock('./skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./skills')>()
  return { ...actual, runSkill: h.runSkill }
})

const sendMessageRequest = (dataPart: unknown, overrides: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0' as const,
  method: 'SendMessage',
  params: {
    message: {
      messageId: 'msg-1',
      role: 'ROLE_USER',
      parts: [{ data: dataPart, mediaType: 'application/json' }],
    },
  },
  id: 1,
  ...overrides,
})

describe('handleJsonRpcRequest — protocol-level validation', () => {
  it('rejects a request with the wrong jsonrpc version', async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: '1.0', method: 'SendMessage', id: 1 })
    expect('error' in res && res.error.code).toBe(-32600)
  })

  it('rejects a request with no method', async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 1 })
    expect('error' in res && res.error.code).toBe(-32600)
  })

  it('preserves the request id on error, defaulting to null when absent', async () => {
    const withId = await handleJsonRpcRequest({ jsonrpc: '2.0', method: 'Bogus', id: 42 })
    expect(withId.id).toBe(42)
    const withoutId = await handleJsonRpcRequest({ jsonrpc: '2.0', method: 'Bogus' })
    expect(withoutId.id).toBeNull()
  })

  it('returns METHOD_NOT_FOUND for a totally unrecognized method', async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: '2.0', method: 'DoSomethingWeird', id: 1 })
    expect('error' in res && res.error.code).toBe(-32601)
  })

  it('returns UNSUPPORTED_OPERATION for a real A2A method this server chooses not to implement', async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: '2.0', method: 'CancelTask', id: 1 })
    expect('error' in res && res.error.code).toBe(-32004)
  })
})

describe('handleJsonRpcRequest — SendMessage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns INVALID_PARAMS when the message has no parts', async () => {
    const res = await handleJsonRpcRequest({
      jsonrpc: '2.0',
      method: 'SendMessage',
      params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [] } },
      id: 1,
    })
    expect('error' in res && res.error.code).toBe(-32602)
  })

  it('rejects (as a task, not a JSON-RPC error) a message with no recognizable skill', async () => {
    const res = await handleJsonRpcRequest(sendMessageRequest({ skill: 'book_a_cruise', input: {} }))
    expect('result' in res).toBe(true)
    const task = 'result' in res ? (res.result as { task: { status: { state: string } } }).task : null
    expect(task?.status.state).toBe('TASK_STATE_REJECTED')
  })

  it('runs the skill and returns a completed task with the result as an artifact', async () => {
    h.runSkill.mockResolvedValue({ cruises: [] })
    const res = await handleJsonRpcRequest(sendMessageRequest({ skill: 'list_cruises', input: {} }))
    expect(h.runSkill).toHaveBeenCalledWith('list_cruises', {})
    expect('result' in res).toBe(true)
    if ('result' in res) {
      const task = (res.result as { task: import('./types').Task }).task
      expect(task.status.state).toBe('TASK_STATE_COMPLETED')
      expect(task.artifacts[0].parts[0]).toEqual({ data: { cruises: [] }, mediaType: 'application/json' })
      expect(task.history).toHaveLength(1)
    }
  })

  it('maps a SkillInputError to a REJECTED task carrying the error message', async () => {
    h.runSkill.mockRejectedValue(new SkillInputError('bad date'))
    const res = await handleJsonRpcRequest(sendMessageRequest({ skill: 'check_availability', input: {} }))
    if ('result' in res) {
      const task = (res.result as { task: import('./types').Task }).task
      expect(task.status.state).toBe('TASK_STATE_REJECTED')
      expect(task.status.message?.parts[0]).toEqual({ text: 'bad date' })
    }
  })

  it('maps an unexpected thrown error to a FAILED task, not a JSON-RPC error', async () => {
    h.runSkill.mockRejectedValue(new Error('supabase is down'))
    const res = await handleJsonRpcRequest(sendMessageRequest({ skill: 'list_cruises', input: {} }))
    if ('result' in res) {
      const task = (res.result as { task: import('./types').Task }).task
      expect(task.status.state).toBe('TASK_STATE_FAILED')
    }
  })

  it('saves the resulting task so it can be fetched again via GetTask', async () => {
    h.runSkill.mockResolvedValue({ ok: true })
    const res = await handleJsonRpcRequest(sendMessageRequest({ skill: 'list_cruises', input: {} }))
    const taskId = 'result' in res ? (res.result as { task: import('./types').Task }).task.id : ''
    expect(getTask(taskId)).not.toBeNull()
  })
})

describe('handleJsonRpcRequest — GetTask', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns TASK_NOT_FOUND for an unknown id', async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: '2.0', method: 'GetTask', params: { id: 'nonexistent' }, id: 1 })
    expect('error' in res && res.error.code).toBe(-32001)
  })

  it('returns INVALID_PARAMS when id is missing', async () => {
    const res = await handleJsonRpcRequest({ jsonrpc: '2.0', method: 'GetTask', params: {}, id: 1 })
    expect('error' in res && res.error.code).toBe(-32602)
  })

  it('returns a previously created task by id', async () => {
    h.runSkill.mockResolvedValue({ ok: true })
    const created = await handleJsonRpcRequest(sendMessageRequest({ skill: 'list_cruises', input: {} }))
    const taskId = 'result' in created ? (created.result as { task: import('./types').Task }).task.id : ''

    const fetched = await handleJsonRpcRequest({ jsonrpc: '2.0', method: 'GetTask', params: { id: taskId }, id: 2 })
    expect('result' in fetched && (fetched.result as import('./types').Task).id).toBe(taskId)
  })
})
