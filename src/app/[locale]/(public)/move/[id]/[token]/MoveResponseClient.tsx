'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, Clock3, Undo2 } from 'lucide-react'

interface Offer {
  guestName: string | null
  cruiseTitle: string | null
  date: string | null
  guestCount: number | null
  boat: string | null
  currentStartAt: string | null
  proposedStartAt: string | null
  totalCents: number | null
  incentive: string | null
}

interface Props {
  locale: string
  proposalId: string
  token: string
  offer: Offer
  initialResponse: string | null
  expired: boolean
  sent: boolean
}

/** Amsterdam wall-clock time, rendered client-side from the ISO stamp. */
function amsTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  })
}

const STRINGS = {
  en: {
    title: 'Small favour to ask',
    hi: (name: string | null) => `Hi${name ? ` ${name.split(' ')[0]}` : ''},`,
    body: 'Would a slightly different departure time work for you? Everything else stays exactly the same — same boat, same cruise, same price.',
    current: 'Your current departure',
    proposed: 'Proposed departure',
    sweetener: (s: string) => `And because you'd be helping us out: ${s}.`,
    price: (eur: string) => `Price stays ${eur} — nothing changes there.`,
    accept: "Yes, that's fine",
    decline: 'Keep my original time',
    acceptedTitle: 'Great — thank you!',
    acceptedBody: "We'll move your booking and send you a confirmation email shortly. The wine is on us.",
    declinedTitle: 'No problem at all!',
    declinedBody: 'Your original departure time stays exactly as booked. See you on the water.',
    deferredTitle: 'Take your time',
    deferredBody: 'This link keeps working — tap it again once you know. Your original time stays reserved either way.',
    expiredTitle: 'This request has expired',
    expiredBody: 'No worries — your booking is unchanged, at your original time.',
    error: 'Something went wrong — please try again.',
  },
  nl: {
    title: 'Kleine vraag',
    hi: (name: string | null) => `Hoi${name ? ` ${name.split(' ')[0]}` : ''},`,
    body: 'Zou een iets andere vertrektijd jullie ook uitkomen? Al het andere blijft precies hetzelfde — zelfde boot, zelfde cruise, zelfde prijs.',
    current: 'Jullie huidige vertrek',
    proposed: 'Voorgestelde vertrek',
    sweetener: (s: string) => `En omdat je ons ermee helpt: ${s === 'a bottle of wine on the house' ? 'een fles wijn van het huis' : s}.`,
    price: (eur: string) => `De prijs blijft ${eur} — daar verandert niets aan.`,
    accept: 'Ja, dat is goed',
    decline: 'Liever mijn originele tijd',
    acceptedTitle: 'Top — dank je wel!',
    acceptedBody: 'We verzetten je boeking en sturen zo een bevestigingsmail. De wijn staat koud.',
    declinedTitle: 'Helemaal geen probleem!',
    declinedBody: 'Je originele vertrektijd blijft gewoon staan. Tot op het water.',
    deferredTitle: 'Neem de tijd',
    deferredBody: 'Deze link blijft werken — tik er nog eens op zodra je het weet. Je originele tijd blijft sowieso gereserveerd.',
    expiredTitle: 'Dit verzoek is verlopen',
    expiredBody: 'Geen zorgen — je boeking staat onveranderd op je originele tijd.',
    error: 'Er ging iets mis — probeer het nog eens.',
  },
}

export default function MoveResponseClient({ locale, proposalId, token, offer, initialResponse, expired, sent }: Props) {
  const t = STRINGS[locale === 'nl' ? 'nl' : 'en']
  const [response, setResponse] = useState<string | null>(initialResponse)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)

  async function respond(answer: 'accept' | 'decline') {
    setBusy(answer)
    setError(false)
    try {
      const res = await fetch('/api/move/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposalId, token, response: answer }),
      })
      if (!res.ok) throw new Error('failed')
      setResponse(answer)
    } catch {
      setError(true)
    } finally {
      setBusy(null)
    }
  }

  const eur = offer.totalCents != null ? `€${(offer.totalCents / 100).toFixed(2)}` : ''

  let content: React.ReactNode
  if (expired) {
    content = <Outcome icon={<Clock3 className="w-10 h-10 text-zinc-400" />} title={t.expiredTitle} body={t.expiredBody} />
  } else if (response === 'accept') {
    content = <Outcome icon={<CheckCircle2 className="w-10 h-10 text-emerald-500" />} title={t.acceptedTitle} body={t.acceptedBody} />
  } else if (response === 'decline') {
    content = <Outcome icon={<Undo2 className="w-10 h-10 text-indigo-500" />} title={t.declinedTitle} body={t.declinedBody} />
  } else if (response === 'defer') {
    content = (
      <>
        <Outcome icon={<Clock3 className="w-10 h-10 text-amber-500" />} title={t.deferredTitle} body={t.deferredBody} />
        <div className="mt-6 space-y-3">
          <ResponseButton primary label={t.accept} busy={busy === 'accept'} onClick={() => respond('accept')} />
          <ResponseButton label={t.decline} busy={busy === 'decline'} onClick={() => respond('decline')} />
        </div>
      </>
    )
  } else {
    content = (
      <>
        <p className="text-lg font-medium text-zinc-900">{t.hi(offer.guestName)}</p>
        <p className="mt-2 text-zinc-600">{t.body}</p>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 space-y-3">
          {offer.cruiseTitle && (
            <p className="text-sm font-semibold text-zinc-800">
              {offer.cruiseTitle}
              {offer.date ? ` · ${offer.date}` : ''}
              {offer.guestCount ? ` · ${offer.guestCount} ${locale === 'nl' ? 'personen' : 'guests'}` : ''}
            </p>
          )}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1 rounded-xl bg-white border border-zinc-200 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-zinc-400">{t.current}</p>
              <p className="text-lg font-semibold text-zinc-500 line-through">{amsTime(offer.currentStartAt)}</p>
            </div>
            <span className="text-zinc-400">→</span>
            <div className="flex-1 rounded-xl bg-white border border-indigo-200 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-indigo-400">{t.proposed}</p>
              <p className="text-lg font-semibold text-indigo-700">{amsTime(offer.proposedStartAt)}</p>
            </div>
          </div>
          {offer.incentive && <p className="text-sm text-zinc-700">🍷 {t.sweetener(offer.incentive)}</p>}
          {eur && <p className="text-xs text-zinc-500">{t.price(eur)}</p>}
        </div>

        <div className="mt-6 space-y-3">
          <ResponseButton primary label={t.accept} busy={busy === 'accept'} onClick={() => respond('accept')} />
          <ResponseButton label={t.decline} busy={busy === 'decline'} onClick={() => respond('decline')} />
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{t.error}</p>}
        {!sent && (
          <p className="mt-4 text-xs text-zinc-400">
            (Preview — this request hasn&apos;t been sent to the guest yet.)
          </p>
        )}
      </>
    )
  }

  return (
    <main className="min-h-screen bg-white px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Off Course Amsterdam</p>
        <h1 className="mt-1 text-2xl font-bold text-zinc-900">{t.title}</h1>
        <div className="mt-6">{content}</div>
      </div>
    </main>
  )
}

function Outcome({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center">
      <div className="flex justify-center">{icon}</div>
      <p className="mt-3 text-lg font-semibold text-zinc-900">{title}</p>
      <p className="mt-1 text-sm text-zinc-600">{body}</p>
    </div>
  )
}

function ResponseButton({
  label,
  onClick,
  busy,
  primary,
}: {
  label: string
  onClick: () => void
  busy: boolean
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`w-full min-h-[48px] rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2 ${
        primary
          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
          : 'bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50'
      }`}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {label}
    </button>
  )
}
