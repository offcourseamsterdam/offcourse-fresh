import { CLAUDE_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { describeImageWithGemini } from '@/lib/ai/describe-image'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractJson } from '@/lib/ghost/ops-drafters'
import { postSlackDM } from '@/lib/slack/send-notification'

/**
 * The maintenance agent — shadow mode.
 *
 * Fires when someone posts in the Slack "Maintenance and Ideas" channel
 * (text and/or photos). It:
 *   1. describes any photos with Gemini (metered) — turns an image into words
 *   2. assigns a priority: essential / cosmetic / wishlist
 *   3. drafts a quote-request email to the technician/handyman
 * and writes two rows: a durable `maintenance_tasks` record (the board) and a
 * `maintenance_task` agent_proposals row carrying the email draft (the Ghost
 * shadow action — sent later by a human via the proposals route).
 *
 * Same hard rules as the other drafters: status 'shadow', nothing is sent,
 * every AI call metered, skip-first, all errors swallowed (never breaks the
 * Slack webhook).
 */

export interface MaintenancePhoto {
  base64: string
  mimeType: string
  /** Public/stored URL kept on the task for the board + the email. */
  url?: string
}

export interface MaintenanceInput {
  /** Slack event id — dedupe key (one task per event). */
  slackEventId: string
  text: string
  reporter?: string
  channel?: string
  photos?: MaintenancePhoto[]
  /** 'slack' (default) or 'admin' for the admin-form path. */
  source?: 'slack' | 'admin'
  /** Explicit boat ID when resolved from skipper shift or command input */
  boatId?: string | null
  /** Explicit boat name */
  boatName?: string | null
}

const PHOTO_PROMPT =
  'You are looking at a photo from a boat maintenance/ideas report for an electric canal-boat company. In 1-2 factual sentences, describe what is shown, focusing on any damage, wear, fault or the specific thing being pointed out. If it is not a problem photo, just describe the scene plainly.'

const MAX_PHOTOS = 4

export async function draftMaintenanceTask(input: MaintenanceInput): Promise<'drafted' | 'skipped'> {
  try {
    const text = (input.text ?? '').trim()
    const photos = (input.photos ?? []).slice(0, MAX_PHOTOS)
    // Skip-first: nothing to work with → no AI call.
    if (!text && !photos.length) return 'skipped'
    if (!input.slackEventId) return 'skipped'

    const supabase = createAdminClient()

    // Dedupe per Slack event (the unique index is the hard guard; this avoids
    // spending AI tokens on a replayed delivery).
    const { data: existing } = await supabase
      .from('maintenance_tasks')
      .select('id')
      .eq('source_slack_event_id', input.slackEventId)
      .limit(1)
    if (existing?.length) return 'skipped'

    // ── 1. Describe photos (Gemini, metered) ──────────────────────────────
    const photoDescriptions: string[] = []
    for (const photo of photos) {
      try {
        const desc = await describeImageWithGemini(photo.base64, photo.mimeType, PHOTO_PROMPT, {
          feature: 'ghost_maintenance_photo',
        })
        if (desc) photoDescriptions.push(desc)
      } catch (err) {
        // A photo we can't read shouldn't sink the whole report.
        console.error('[ghost/maintenance] photo describe failed:', err instanceof Error ? err.message : err)
      }
    }

    // Boats for name → id mapping (so a mentioned boat links to the record).
    const { data: boats } = await supabase.from('boats').select('id, name')
    const boatNames = (boats ?? []).map(b => b.name).join(', ')

    // ── 2 + 3. Classify + draft the technician email (one metered call) ────
    const photoBlock = photoDescriptions.length
      ? `\nPHOTOS (AI descriptions):\n${photoDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : ''

    const response = await meteredMessage('ghost_maintenance_task', {
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `You are the shadow maintenance assistant for Off Course Amsterdam (electric canal boats: ${boatNames || 'Diana, Curaçao'}). Someone posted this in the "Maintenance and Ideas" channel. This is a SHADOW proposal — nothing is sent; a human reviews it.

Do three things:
1. Assign a PRIORITY — exactly one of:
   - "essential": must-fix. Safety, or the boat can't run / be used properly until it's done.
   - "cosmetic": nice-to-fix. Appearance, comfort or polish — doesn't stop the boat working.
   - "wishlist": a future idea or nice-to-have, not a current problem.
2. Write a clear, short title and a clean 1-3 sentence summary of the issue/idea (fix grammar, keep the facts; incorporate the photo descriptions if relevant).
3. Draft a friendly, concise email to our technician/handyman. For "essential"/"cosmetic": describe the problem clearly and ask for an estimate/offerte. For a "wishlist" idea: describe it and ask if it's feasible and roughly what it would cost. Sign off as "Off Course Amsterdam". Keep it human and to the point — no corporate fluff.

MESSAGE${input.reporter ? ` (from ${input.reporter})` : ''}:
${text || '(no text — see photos)'}${photoBlock}

Return JSON only:
{"priority": "essential|cosmetic|wishlist", "title": "<short>", "summary": "<1-3 sentences>", "boat": "<one of: ${boatNames || 'Diana, Curaçao'}, or null>", "email_subject": "<subject>", "email_body": "<the full email body>", "reasoning": "<1 sentence: why this priority>"}`,
        },
      ],
    })

    const parsed = extractJson(firstText(response))
    const priority = parsed?.priority
    if (!parsed || (priority !== 'essential' && priority !== 'cosmetic' && priority !== 'wishlist')) {
      return 'skipped'
    }

    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : text.slice(0, 80) || 'Maintenance item'
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''

    const resolvedBoatId =
      input.boatId !== undefined
        ? input.boatId
        : typeof parsed.boat === 'string'
          ? (boats ?? []).find(b => b.name.toLowerCase() === (parsed.boat as string).toLowerCase())?.id ?? null
          : null
    const resolvedBoatName =
      input.boatName ||
      (resolvedBoatId ? (boats ?? []).find(b => b.id === resolvedBoatId)?.name : null)
    const photoUrls = photos.map(p => p.url).filter((u): u is string => !!u)

    // ── Write the durable board record ────────────────────────────────────
    const { data: task, error: taskErr } = await supabase
      .from('maintenance_tasks')
      .insert({
        boat_id: resolvedBoatId,
        title,
        description: summary || text || null,
        priority,
        status: 'open',
        photo_urls: photoUrls,
        photo_descriptions: photoDescriptions,
        source: input.source ?? 'slack',
        source_slack_event_id: input.slackEventId,
        source_channel: input.channel ?? null,
        reporter: input.reporter ?? null,
      })
      .select('id')
      .single()
    if (taskErr || !task) {
      // Unique-index conflict = a concurrent delivery already created it.
      console.error('[ghost/maintenance] task insert failed:', taskErr?.message)
      return 'skipped'
    }

    // ── Write the Ghost email proposal (shadow) ───────────────────────────
    const recipient = process.env.MAINTENANCE_EMAIL_RECIPIENT ?? null
    const { data: proposal } = await supabase
      .from('agent_proposals')
      .insert({
        kind: 'maintenance_task',
        status: 'shadow',
        model: CLAUDE_MODEL,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
        payload: {
          maintenance_task_id: task.id,
          priority,
          title,
          summary,
          photo_descriptions: photoDescriptions,
          email_subject: typeof parsed.email_subject === 'string' ? parsed.email_subject : `Maintenance: ${title}`,
          email_body: typeof parsed.email_body === 'string' ? parsed.email_body : summary,
          recipient,
        },
      })
      .select('id')
      .single()

    if (proposal) {
      await supabase.from('maintenance_tasks').update({ proposal_id: proposal.id }).eq('id', task.id)

      // Notify Beer (manager) directly in DM about the maintenance report (Beer, 2026-09-04)
      const boatBadge = resolvedBoatName ? `⛵️ Boot: *${resolvedBoatName}*\n` : ''
      await postSlackDM(
        `🔧 *Nieuwe Maintenance Melding* door ${input.reporter || 'iemand'}:\n` +
        `*${title}* (${priority.toUpperCase()})\n` +
        boatBadge +
        `"${summary}"\n` +
        (photoDescriptions.length > 0 ? `📸 ${photoDescriptions.length} foto('s) geanalyseerd door AI\n` : '') +
        `👉 Bekijk & stuur offerteverzoek in Admin ➔ Maintenance: https://offcourse-fresh.vercel.app/nl/admin/maintenance`
      )
    }

    return 'drafted'
  } catch (err) {
    console.error('[ghost/maintenance_task] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}
