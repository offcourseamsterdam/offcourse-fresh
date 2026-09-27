import type { Task } from './types'

/**
 * In-memory store for completed A2A tasks, so `GetTask` can re-fetch a task
 * shortly after `SendMessage` created it. Same tradeoff as
 * src/lib/rate-limit.ts: no external dependency, per-instance only (a
 * serverless cold start or a different Vercel instance won't see it) — fine
 * here because every task this server creates finishes synchronously within
 * the original request; GetTask is a convenience, not the only way to learn
 * the result.
 */
const TASK_TTL_MS = 10 * 60_000

const tasks = new Map<string, { task: Task; expiresAt: number }>()

let lastCleanup = Date.now()
const CLEANUP_INTERVAL_MS = 60_000

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [id, entry] of tasks) {
    if (entry.expiresAt < now) tasks.delete(id)
  }
}

export function saveTask(task: Task): void {
  cleanup()
  tasks.set(task.id, { task, expiresAt: Date.now() + TASK_TTL_MS })
}

export function getTask(id: string): Task | null {
  cleanup()
  const entry = tasks.get(id)
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.task
}
