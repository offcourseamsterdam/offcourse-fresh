// ESM preloader — passed via `tsx --import ./scripts/_preload-env.mjs`.
// Runs before any module is evaluated, so env is ready when src/env.ts
// validates at import time (which TypeScript hoisted imports would miss).
import { readFileSync } from 'fs'
import { resolve } from 'path'

try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
} catch { /* rely on existing process.env */ }
