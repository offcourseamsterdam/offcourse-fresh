# Track E — Auth & RBAC Setup

## What's Already Built (In Code)

The entire auth system is coded and ready. You don't need to touch any of these files — they work as-is once Supabase is configured.

### Magic Link Login (Passwordless)
- User enters their email on `/login`
- Supabase sends a magic link to their inbox
- They click it → redirected to `/auth/callback` → session created → sent to their dashboard
- No passwords anywhere. Clean, simple, secure.

### 5 Roles
| Role | Dashboard | Who it's for |
|------|-----------|-------------|
| `admin` | `/admin` | You (Beer) and Jannah — full control |
| `support` | `/support` | Team members managing bookings and content |
| `captain` | `/captain` | Skippers viewing their schedule and trips |
| `partner` | `/partner` | Affiliate partners seeing reports and invoices |
| `guest` | `/account` | Customers viewing their bookings |

### Route Protection
Every dashboard route is locked by role. If a captain tries to visit `/admin`, they get redirected to `/captain`. If someone isn't logged in, they go to `/login`. This happens both:
- **Server-side** (in `ProtectedLayout`) — the real security gate
- **Client-side** (in `RoleGate`) — hides UI elements the user shouldn't see

### Automatic Profile Creation
When someone signs up (via magic link or admin invite), a database trigger automatically creates a `user_profiles` row with `role = 'guest'`. Admins can then change the role from the admin panel.

### Admin User Management
Admins can:
- View all users at `/admin/users`
- Change anyone's role
- Deactivate/reactivate accounts
- Invite new users with a specific role (sends them a magic link)

---

## Key Files

| File | What it does |
|------|-------------|
| `src/app/[locale]/login/page.tsx` | Login page with magic link form |
| `src/app/auth/callback/route.ts` | Handles the magic link redirect, exchanges code for session |
| `src/app/auth/signout/route.ts` | Signs user out and redirects home |
| `src/app/api/auth/profile/route.ts` | API endpoint to fetch current user's profile |
| `src/app/api/admin/users/route.ts` | List users, update role/status (admin only) |
| `src/app/api/admin/users/invite/route.ts` | Invite new users with magic link (admin only) |
| `src/components/auth/AuthProvider.tsx` | Client-side auth context — wraps entire app |
| `src/components/auth/ProtectedLayout.tsx` | Server-side route guard — checks role before rendering |
| `src/components/auth/RoleGate.tsx` | Client-side UI gate — shows/hides elements by role |
| `src/components/auth/AdminSignOutButton.tsx` | Sign-out button for dashboard sidebars |
| `src/components/layout/DashboardSidebar.tsx` | Shared sidebar for all dashboard layouts |
| `src/lib/auth/types.ts` | Role types, VALID_ROLES, ROLE_ACCESS, getDashboardPath |
| `src/lib/auth/server.ts` | Server-side helpers: getSession, getUserProfile, requireRole |
| `src/lib/auth/hooks.ts` | Client-side hooks: useAuth, useRequireRole |
| `src/lib/auth/middleware.ts` | Supabase client for proxy/middleware context |
| `src/proxy.ts` | Checks auth on protected routes, skips public pages |
| `supabase/migrations/001_user_profiles.sql` | Database migration: table, trigger, RLS policies |

---

## What You (Beer) Need To Do In Supabase

These are the only manual steps. Everything else is handled by code.

### Step 1: Run the migration SQL

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Paste the entire contents of `supabase/migrations/001_user_profiles.sql`
3. Click **Run**

This creates:
- The `user_profiles` table (linked 1-to-1 with Supabase auth users)
- A trigger that auto-creates a profile when someone signs up
- RLS policies so users can only read their own profile (admins can read all)

### Step 2: Add redirect URLs to Supabase Auth

1. Go to **Supabase Dashboard** → **Authentication** → **URL Configuration**
2. Set **Site URL** to: `https://off-course-amsterdam.vercel.app`
3. Under **Redirect URLs**, add:
   - `https://off-course-amsterdam.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback`

This tells Supabase where to send people after they click the magic link email.

### Step 3: Test the login flow

1. Visit `https://off-course-amsterdam.vercel.app/en/login`
2. Enter your email
3. Check your inbox — you should get a "Sign in to Off Course" email
4. Click the magic link
5. You should land on `/en/account` (new users get `guest` role)

If the email doesn't arrive, check **Supabase Dashboard** → **Authentication** → **Email Templates** and make sure email sending is enabled. Supabase has a free tier email limit (~4 emails/hour in dev).

### Step 4: Make yourself admin

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Run:
```sql
UPDATE public.user_profiles
SET role = 'admin'
WHERE email = 'beer@offcourseamsterdam.com';
```
3. Refresh the site — you should now see the admin panel at `/en/admin`

### Step 5 (optional): Regenerate TypeScript types

Run in your terminal:
```bash
npx supabase gen types typescript --project-id fkylzllxvepmrtqxisrn > src/lib/supabase/types.ts
```

This adds the `user_profiles` table to TypeScript autocomplete so the `as any` casts in the admin API routes can be removed.

---

## How It All Fits Together (The Flow)

```
User visits /en/login
  ↓
Enters email → Supabase sends magic link
  ↓
User clicks link in email
  ↓
Browser goes to /auth/callback?code=xyz
  ↓
callback/route.ts exchanges code for session
  ↓
Fetches user profile from user_profiles table
  ↓
Redirects to role-appropriate dashboard:
  admin   → /en/admin
  captain → /en/captain
  support → /en/support
  partner → /en/partner
  guest   → /en/account
```

On every subsequent page load:
- `proxy.ts` checks if the route is protected
- If yes → verifies session with Supabase
- If no session → redirects to `/login`
- If session exists → `ProtectedLayout` checks role
- If wrong role → redirects to correct dashboard

---

## Verification Checklist

After completing Steps 1–4 above:

- [ ] Magic link email arrives when signing in
- [ ] Clicking magic link creates session and redirects correctly
- [ ] `/en/admin` accessible only to admin role
- [ ] `/en/captain` accessible to admin + captain
- [ ] `/en/account` accessible to all authenticated users
- [ ] Non-authenticated users redirected to `/login`
- [ ] Wrong-role users redirected to their own dashboard
- [ ] Admin can view users at `/en/admin/users`
- [ ] Admin can change a user's role
- [ ] Admin can deactivate/reactivate a user
- [ ] Admin can invite a new user with a specific role
