import { describe, it, expect, vi, afterEach } from 'vitest'
import { saveTask, getTask } from './task-store'
import type { Task } from './types'

const makeTask = (id: string): Task => ({
  id,
  contextId: 'ctx-1',
  status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
  artifacts: [],
  history: [],
})

describe('task-store', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a task that was just saved', () => {
    const task = makeTask('task-1')
    saveTask(task)
    expect(getTask('task-1')).toEqual(task)
  })

  it('returns null for an id that was never saved', () => {
    expect(getTask('never-saved')).toBeNull()
  })

  it('expires a task after its TTL', () => {
    vi.useFakeTimers()
    const task = makeTask('task-expiring')
    saveTask(task)
    expect(getTask('task-expiring')).toEqual(task)

    vi.advanceTimersByTime(11 * 60_000)
    expect(getTask('task-expiring')).toBeNull()
  })
})
