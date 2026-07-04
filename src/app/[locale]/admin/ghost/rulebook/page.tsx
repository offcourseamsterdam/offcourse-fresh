import Link from 'next/link'
import { BookOpen, ArrowLeft, ShieldCheck, FileText } from 'lucide-react'
import { GHOST_AGENTS, AUTONOMY_LEVEL, AUTONOMY_CEILING, IRREVERSIBLE_KINDS } from '@/lib/ghost/agents'
import { rulebookForAgent } from '@/lib/ghost/rulebook'

/**
 * THE RULEBOOK — what every agent is told (the exact prompt text) and what
 * the code enforces around it (the hard rules), straight from
 * src/lib/ghost/rulebook.ts. Where promptShared is true, the drafter imports
 * the very string shown here — this page cannot drift from reality.
 */

const LEVEL_LABEL: Record<string, string> = {
  propose: 'shadow — drafts only',
  dry_run: 'dry-run — validates, never creates',
  ask: 'ask — a human click executes',
  auto: 'auto',
}

interface Props {
  params: Promise<{ locale: string }>
}

export default async function RulebookPage({ params }: Props) {
  const { locale } = await params

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <Link
        href={`/${locale}/admin/ghost`}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Ghost AI
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <BookOpen className="w-7 h-7 text-violet-600" />
        <h1 className="text-2xl font-bold text-zinc-900">The Rulebook</h1>
      </div>
      <p className="text-sm text-zinc-500 mb-8 max-w-2xl">
        Exactly what each agent is told before it acts (the prompt), and what the code enforces around it
        (the hard rules — these hold no matter what the model wants). Prompts marked{' '}
        <span className="font-semibold text-emerald-700">live</span> are the literal strings the drafters import;
        <span className="font-semibold text-zinc-600"> mirror</span> means the source of truth is in the named file.
        Taught facts (ghost_knowledge) are injected on top of these and live on the Ghost page.
      </p>

      <div className="space-y-10">
        {GHOST_AGENTS.map(agent => {
          const entries = rulebookForAgent(agent.key)
          if (!entries.length) return null
          return (
            <section key={agent.key}>
              <h2 className="text-lg font-bold text-zinc-900">{agent.name}</h2>
              <p className="text-xs text-zinc-500 mb-3">
                {agent.description} · trigger: {agent.trigger}
              </p>

              <div className="space-y-6">
                {entries.map(entry => (
                  <div key={entry.kind} className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <h3 className="font-semibold text-zinc-900">{entry.title}</h3>
                      <code className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">{entry.kind}</code>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold uppercase tracking-wide">
                        {LEVEL_LABEL[AUTONOMY_LEVEL[entry.kind] ?? 'propose']}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        ceiling: {AUTONOMY_CEILING[entry.kind] ?? 'propose'}
                        {(IRREVERSIBLE_KINDS as readonly string[]).includes(entry.kind) ? ' · pinned (CI-tested)' : ''}
                      </span>
                    </div>

                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Hard rules — enforced in code
                    </p>
                    <ul className="space-y-1 mb-4">
                      {entry.hardRules.map((r, i) => (
                        <li key={i} className="text-sm text-zinc-700 bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-1.5">
                          {r.rule}
                          <span className="block text-[10px] text-zinc-400 font-mono mt-0.5">{r.enforcedIn}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1 flex items-center gap-1">
                      <FileText className="w-3 h-3" /> The prompt
                      <span
                        className={`ml-1 px-1.5 py-0.5 rounded-full font-semibold ${
                          entry.promptShared ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
                        }`}
                      >
                        {entry.promptShared ? 'live' : 'mirror'}
                      </span>
                    </p>
                    <pre className="text-xs text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 whitespace-pre-wrap font-mono">
                      {entry.prompt}
                    </pre>
                    <p className="text-[11px] text-zinc-400 mt-1.5">
                      + injected at runtime: {entry.dataInjected.join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
