import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { apiOk, apiError } from '@/lib/api/response'
import { partnerInviteEmailHtml } from '@/emails/PartnerInviteEmail'

const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * POST /api/admin/partners/[id]/invite
 *
 * Creates a Supabase auth user for the partner (or finds an existing one),
 * generates a Supabase invite link, and sends a branded email via Resend.
 *
 * We avoid Supabase's built-in email delivery (rate-limited free-tier SMTP)
 * by using generateLink + Resend instead of inviteUserByEmail.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    // ── Fetch partner ──────────────────────────────────────────────────────
    const { data: partner } = await supabase
      .from('partners')
      .select('id, name, email')
      .eq('id', id)
      .single()

    if (!partner) return apiError('Partner not found', 404)
    if (!partner.email) return apiError('Partner has no email address — add one first', 400)

    // ── Supabase admin client (service role) ───────────────────────────────
    const authAdmin = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
    const redirectTo = `${siteUrl}/auth/callback?locale=en`

    // ── Check for existing linked user_profile ─────────────────────────────
    // If an account already exists we still send the email — just as a
    // magic-link (sign in) rather than an invite (account setup).
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id, email')
      .eq('partner_id', id)
      .maybeSingle()

    const accountExists = Boolean(existingProfile)

    // ── Ensure the auth user exists ────────────────────────────────────────
    let authUserId: string | null = existingProfile?.id ?? null

    if (!accountExists) {
      const { data: createData, error: createError } = await authAdmin.auth.admin.createUser({
        email: partner.email,
        email_confirm: false,
      })

      if (!createError && createData?.user) {
        authUserId = createData.user.id
      } else if (
        createError?.message?.toLowerCase().includes('already been registered') ||
        createError?.message?.toLowerCase().includes('already exists')
      ) {
        const { data: listData } = await authAdmin.auth.admin.listUsers({ perPage: 1000 })
        const existing = listData?.users?.find(u => u.email?.toLowerCase() === partner.email!.toLowerCase())
        if (existing) authUserId = existing.id
      } else if (createError) {
        return apiError(createError.message)
      }
    }

    // ── Generate invite link (new account) or magic link (existing account) ─
    const linkType = accountExists ? 'magiclink' : 'invite'
    const { data: linkData, error: linkError } = await authAdmin.auth.admin.generateLink({
      type: linkType,
      email: partner.email,
      options: { redirectTo, data: { display_name: partner.name } },
    })

    if (linkError || !linkData?.properties?.action_link) {
      return apiError(linkError?.message ?? 'Failed to generate invite link')
    }

    const inviteUrl = linkData.properties.action_link

    // ── Link user_profile to partner ───────────────────────────────────────
    if (authUserId) {
      await supabase
        .from('user_profiles')
        .upsert({
          id: authUserId,
          email: partner.email,
          display_name: partner.name,
          role: 'partner',
          partner_id: id,
          is_active: true,
        }, { onConflict: 'id' })
    }

    // ── Send branded email via Resend ──────────────────────────────────────
    const { error: sendError } = await resend.emails.send({
      from: 'Off Course Amsterdam <info@offcourseamsterdam.com>',
      to: [partner.email],
      subject: 'Your Off Course Amsterdam partner portal invite',
      html: partnerInviteEmailHtml({ partnerName: partner.name, inviteUrl }),
    })

    if (sendError) {
      console.error('[invite] Resend error:', sendError)
      return apiError(`User created but email failed to send: ${sendError.message}`)
    }

    const verb = accountExists ? 'Login link' : 'Invite'
    return apiOk({ message: `${verb} sent to ${partner.email}`, userId: authUserId })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
