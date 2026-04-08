# Track E: Admin Shell + Authentication

**Phase:** 2
**Dependencies:** Phase 1 complete
**Must complete before:** Tracks F, G

## Objective
Build the admin panel shell (layout, sidebar, routing) with Supabase Auth (magic link) and role-based access control.

## Steps

### E1. Admin Layout (`src/app/admin/layout.tsx`)
- Sidebar navigation with collapsible sections
- Top bar with user info + logout
- Protected route — redirect to login if not authenticated
- Responsive: sidebar collapses to hamburger on mobile

### E2. Supabase Auth Integration
- `POST /api/auth/login` — sends magic link via Supabase Auth
- `POST /api/auth/logout` — signs out
- Auth middleware in `src/middleware.ts` — check `/admin/*` routes for valid session
- Create `admin_users` table (see implementation plan)
- Only users in `admin_users` with `is_active = true` can access admin

### E3. Role-Based Access
Roles: `owner`, `admin`, `editor`, `viewer`
- `owner`: full access + user management
- `admin`: full access except user management
- `editor`: content management only (no bookings, no settings)
- `viewer`: read-only dashboard access

Implement as middleware + React context for conditional UI rendering.

### E4. Admin Dashboard (`src/app/admin/dashboard/page.tsx`)
- KPI cards: bookings today, revenue this week, upcoming bookings
- Quick-access links to common tasks
- Data from `bookings` table + Stripe (if connected)

## Verification Checklist
- [ ] Magic link login works
- [ ] Non-admin users are rejected
- [ ] Sidebar renders with all navigation items
- [ ] Role-based access: editor can't see settings
- [ ] Dashboard shows live booking data
- [ ] Logout works and redirects to login
