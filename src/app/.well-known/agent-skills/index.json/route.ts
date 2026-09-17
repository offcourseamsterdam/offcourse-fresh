import { BOOK_A_CRUISE_SKILL_MD } from '@/lib/agent-skills/book-a-cruise-skill'
import { sha256Digest } from '@/lib/agent-skills/digest'

// GET /.well-known/agent-skills/index.json
// Agent Skills Discovery index, per
// https://github.com/cloudflare/agent-skills-discovery-rfc v0.2.0. The
// digest is computed from the exact string the SKILL.md route serves, so
// the two can never drift out of sync.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

export function GET() {
  return Response.json({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [
      {
        name: 'book-a-cruise',
        type: 'skill-md',
        description: 'Find, price, and check availability for an Off Course Amsterdam canal cruise, then hand off to checkout.',
        url: `${SITE_URL}/.well-known/agent-skills/book-a-cruise/SKILL.md`,
        digest: sha256Digest(BOOK_A_CRUISE_SKILL_MD),
      },
    ],
  })
}
