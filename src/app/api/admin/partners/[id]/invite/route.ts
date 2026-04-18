import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'
import { createClient as createAuthAdmin } from '@supabase/supabase-js'

/**
 * POST /api/admin/partners/[id]/invite
 * Creates a Supabase auth user for the partner and sends them a magic link.
 * Links the user_profiles record to the partner via partner_id.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    // Get the partner (need their email)
    const { data: partner } = await supabase
      .from('partners')
      .select('id, name, email')
      .eq('id', id)
      .single()

    if (!partner) return apiError('Partner not found', 404)
    if (!partner.email) return apiError('Partner has no email address — add one first', 400)

    // Check if a user already exists for this partner
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id, email')
      .eq('partner_id', id)
      .maybeSingle()

    if (existingProfile) {
      return apiError(`A user account already exists for this partner (${existingProfile.email})`, 409)
    }

    // Use the Supabase admin auth API to invite the user
    const authAdmin = createAuthAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefirmUser: false } as any }
    )

    // Create the user via admin API (sends invite email automatically)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
    const { data: authData, error: authError } = await authAdmin.auth.admin.inviteUserByEmail(
      partner.email,
      {
        redirectTo: `${siteUrl}/auth/callback?locale=en`,
        data: { display_name: partner.name },
      }
    )

    if (authError) {
      // User might already exist in auth but not linked
      if (authError.message.includes('already been registered')) {
        // Find the existing auth user and link them
        const { data: users } = await authAdmin.auth.admin.listUsers()
        const existingUser = users?.users?.find(u => u.email === partner.email)

        if (existingUser) {
          // Create/update their profile with partner_id
          await supabase
            .from('user_profiles')
            .upsert({
              id: existingUser.id,
              email: partner.email,
              display_name: partner.name,
              role: 'partner',
              partner_id: id,
              is_active: true,
            }, { onConflict: 'id' })

          // Send them a magic link
          const { error: otpError } = await authAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: partner.email,
            options: { redirectTo: `${siteUrl}/auth/callback?locale=en` },
          })

          return apiOk({
            message: `Existing user linked to partner. ${otpError ? 'Could not send login link.' : 'Login link sent.'}`,
            linked: true,
          })
        }
      }
      return apiError(authError.message)
    }

    // Create their user_profiles record with partner_id
    if (authData?.user) {
      await supabase
        .from('user_profiles')
        .upsert({
          id: authData.user.id,
          email: partner.email,
          display_name: partner.name,
          role: 'partner',
          partner_id: id,
          is_active: true,
        }, { onConflict: 'id' })
    }

    return apiOk({
      message: `Invite sent to ${partner.email}`,
      userId: authData?.user?.id,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
