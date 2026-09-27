import { randomUUID } from 'node:crypto'
import { isSkillId, runSkill, SkillInputError } from './skills'
import { getTask as loadTask, saveTask } from './task-store'
import { JSON_RPC_ERROR_CODE, type JsonRpcRequest, type JsonRpcResponse, type Message, type Part, type Task } from './types'

function firstDataPart(parts: Part[] | undefined): Record<string, unknown> | null {
  const dataPart = (parts ?? []).find((p): p is { data: unknown } => 'data' in p)
  if (!dataPart || typeof dataPart.data !== 'object' || dataPart.data === null) return null
  return dataPart.data as Record<string, unknown>
}

function completedTask(id: string, contextId: string, history: Message[], resultData: unknown): Task {
  return {
    id,
    contextId,
    status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
    artifacts: [{ artifactId: randomUUID(), name: 'skill_result', parts: [{ data: resultData, mediaType: 'application/json' }] }],
    history,
  }
}

function unsuccessfulTask(id: string, contextId: string, history: Message[], state: 'TASK_STATE_REJECTED' | 'TASK_STATE_FAILED', reason: string): Task {
  return {
    id,
    contextId,
    status: {
      state,
      message: { messageId: randomUUID(), role: 'ROLE_AGENT', parts: [{ text: reason }] },
      timestamp: new Date().toISOString(),
    },
    artifacts: [],
    history,
  }
}

/** Handles the `SendMessage` method: runs the requested skill and returns a completed/rejected/failed Task. */
async function handleSendMessage(params: unknown): Promise<Task> {
  const message = (params as { message?: Message } | undefined)?.message
  if (!message || !Array.isArray(message.parts) || message.parts.length === 0) {
    throw { code: JSON_RPC_ERROR_CODE.INVALID_PARAMS, message: 'params.message.parts is required' }
  }

  const taskId = randomUUID()
  const contextId = message.contextId ?? randomUUID()
  const history = [message]

  const invocation = firstDataPart(message.parts)
  const skillId = invocation?.skill
  if (!invocation || !isSkillId(skillId)) {
    const task = unsuccessfulTask(
      taskId,
      contextId,
      history,
      'TASK_STATE_REJECTED',
      `Unknown or missing skill. Send a data Part shaped like { "skill": "list_cruises" | "check_availability", "input": {...} }.`
    )
    saveTask(task)
    return task
  }

  try {
    const result = await runSkill(skillId, invocation.input)
    const task = completedTask(taskId, contextId, history, result)
    saveTask(task)
    return task
  } catch (err) {
    const task =
      err instanceof SkillInputError
        ? unsuccessfulTask(taskId, contextId, history, 'TASK_STATE_REJECTED', err.message)
        : unsuccessfulTask(taskId, contextId, history, 'TASK_STATE_FAILED', 'Internal error running skill')
    if (!(err instanceof SkillInputError)) console.error('[a2a] skill execution failed:', err)
    saveTask(task)
    return task
  }
}

function handleGetTask(params: unknown): Task {
  const id = (params as { id?: unknown } | undefined)?.id
  if (typeof id !== 'string' || !id) {
    throw { code: JSON_RPC_ERROR_CODE.INVALID_PARAMS, message: 'params.id is required' }
  }
  const task = loadTask(id)
  if (!task) {
    throw { code: JSON_RPC_ERROR_CODE.TASK_NOT_FOUND, message: `No task found with id "${id}"` }
  }
  return task
}

/** Real A2A method names this server deliberately doesn't implement (streaming, push notifications, task management beyond GetTask). Distinguishes "not supported" from "not a real method" below. */
const KNOWN_UNIMPLEMENTED_METHODS = new Set([
  'SendStreamingMessage',
  'ListTasks',
  'CancelTask',
  'SubscribeToTask',
  'CreateTaskPushNotificationConfig',
  'GetTaskPushNotificationConfig',
  'ListTaskPushNotificationConfigs',
  'DeleteTaskPushNotificationConfig',
  'GetExtendedAgentCard',
])

/**
 * Dispatches one JSON-RPC 2.0 request to this A2A server. Implements only
 * `SendMessage` and `GetTask` — every other method in the spec
 * (SendStreamingMessage, ListTasks, CancelTask, push notification config,
 * GetExtendedAgentCard) returns UnsupportedOperationError, matching this
 * server's advertised capabilities (no streaming, no push notifications,
 * no auth).
 */
export async function handleJsonRpcRequest(body: unknown): Promise<JsonRpcResponse> {
  const req = body as Partial<JsonRpcRequest> | null
  const id = (req && typeof req === 'object' && 'id' in req ? req.id : null) ?? null

  if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return { jsonrpc: '2.0', id, error: { code: JSON_RPC_ERROR_CODE.INVALID_REQUEST, message: 'Invalid JSON-RPC 2.0 request' } }
  }

  try {
    switch (req.method) {
      case 'SendMessage': {
        const task = await handleSendMessage(req.params)
        return { jsonrpc: '2.0', id, result: { task } }
      }
      case 'GetTask':
        return { jsonrpc: '2.0', id, result: handleGetTask(req.params) }
      default: {
        const code = KNOWN_UNIMPLEMENTED_METHODS.has(req.method)
          ? JSON_RPC_ERROR_CODE.UNSUPPORTED_OPERATION
          : JSON_RPC_ERROR_CODE.METHOD_NOT_FOUND
        return { jsonrpc: '2.0', id, error: { code, message: `Method "${req.method}" is not supported by this agent` } }
      }
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
      return { jsonrpc: '2.0', id, error: err as { code: number; message: string } }
    }
    console.error('[a2a] unexpected error handling request:', err)
    return { jsonrpc: '2.0', id, error: { code: JSON_RPC_ERROR_CODE.INTERNAL_ERROR, message: 'Internal error' } }
  }
}
