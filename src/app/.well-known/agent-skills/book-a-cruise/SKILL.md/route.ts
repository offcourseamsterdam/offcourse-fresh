import { BOOK_A_CRUISE_SKILL_MD } from '@/lib/agent-skills/book-a-cruise-skill'

// GET /.well-known/agent-skills/book-a-cruise/SKILL.md
// The skill artifact referenced from /.well-known/agent-skills/index.json.
export function GET() {
  return new Response(BOOK_A_CRUISE_SKILL_MD, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
