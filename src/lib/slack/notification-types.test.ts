import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  SLACK_NOTIFICATION_TYPES,
  SLACK_NOTIFICATION_KINDS,
  SLACK_NOTIFICATION_CATEGORIES,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  getSlackNotificationType,
} from './notification-types'

/**
 * CATALOG GUARDRAIL
 * =================
 * The admin "notification types" page renders this catalog as documentation, so a
 * stale catalog is worse than none — it confidently describes alerts that no longer
 * exist, or omits ones that do.
 *
 * TypeScript already stops an UNKNOWN kind reaching postSlackText() (the `kind`
 * parameter is a union built from this array). What the compiler can't catch is the
 * other direction: an entry left behind after its call site was deleted. That's what
 * the source scan below is for.
 */

const SRC_DIR = join(process.cwd(), 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Every kind-shaped literal appearing in a file that sends Slack messages.
 *
 * Deliberately a loose scan rather than a parser: message bodies in this codebase
 * contain nested template literals, so anything trying to walk the call arguments
 * exactly desynchronises on them. Looseness is safe in the one direction this is
 * used for below (finding catalog entries nothing sends): a scan that over-collects
 * can only fail to spot an orphan, never invent one.
 *
 * The opposite direction — a kind that is sent but NOT catalogued — needs no test:
 * `kind` is a required parameter typed as the union of this catalog, so an unknown
 * value is a compile error before it can ever run.
 */
function kindsUsedInSource(): Set<string> {
  const used = new Set<string>()
  const kindShape = /'([a-z][a-z_]*\.[a-z][a-z_]*)'/g
  for (const file of walk(SRC_DIR)) {
    if (file.endsWith(join('lib', 'slack', 'send-notification.ts'))) continue
    if (file.endsWith(join('lib', 'slack', 'notification-types.ts'))) continue
    const src = readFileSync(file, 'utf8')
    if (!/postSlack(?:Text|DM|Critical)\s*\(/.test(src)) continue
    let m: RegExpExecArray | null
    while ((m = kindShape.exec(src))) used.add(m[1])
  }
  return used
}

describe('slack notification catalog', () => {
  it('has unique kinds', () => {
    expect(new Set(SLACK_NOTIFICATION_KINDS).size).toBe(SLACK_NOTIFICATION_KINDS.length)
  })

  it('every kind follows the domain.event shape', () => {
    const bad = SLACK_NOTIFICATION_KINDS.filter(k => !/^[a-z][a-z_]*\.[a-z][a-z_]*$/.test(k))
    expect(bad).toEqual([])
  })

  it('every entry is fully documented — the types page renders these verbatim', () => {
    const incomplete = SLACK_NOTIFICATION_TYPES.filter(
      t => !t.label.trim() || !t.trigger.trim() || !t.action.trim() || !t.source.trim(),
    ).map(t => t.kind)
    expect(incomplete).toEqual([])
  })

  it('every category and severity used has a display label', () => {
    for (const t of SLACK_NOTIFICATION_TYPES) {
      expect(CATEGORY_LABELS[t.category]).toBeTruthy()
      expect(SEVERITY_LABELS[t.severity]).toBeTruthy()
      expect(SLACK_NOTIFICATION_CATEGORIES).toContain(t.category)
    }
  })

  it('getSlackNotificationType finds catalogued kinds and shrugs at unknown ones', () => {
    expect(getSlackNotificationType('booking.created')?.category).toBe('bookings')
    expect(getSlackNotificationType('nope.gone')).toBeUndefined()
  })

  it('every catalogued kind is actually sent somewhere in the codebase', () => {
    // Fails when a notification is deleted from the code but left in the catalog —
    // the admin page would keep documenting an alert that can never fire.
    const used = kindsUsedInSource()
    const orphans = SLACK_NOTIFICATION_KINDS.filter(k => !used.has(k))
    expect(orphans).toEqual([])
  })
})
