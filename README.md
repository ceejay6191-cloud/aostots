# Aostot (Backtest build)

## Quick start (Testing / Demo Mode)
If you just want to see the entire website (marketing + dashboard + projects + new project) without setting up Supabase yet:

1. Copy `.env.example` → `.env.local`
2. Make sure it contains:
   - `VITE_DEMO_MODE=true`
3. Install + run:
   - `npm install`
   - `npm run dev`

In demo mode, the app auto-signs you in as a demo user and stores projects in your browser's localStorage.

---

This is a Vite + React + TypeScript app with Supabase Auth + RLS-backed Projects.

## 1) Prerequisites
- Node.js 18+
- A Supabase project

## 2) Configure environment variables
1. Copy `.env.example` to `.env.local`
2. Go to Supabase Dashboard → **Project Settings → API**
3. Paste:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`

> Do **not** commit `.env.local` (it contains secrets).

## 3) Create the database table + RLS
Run the migration SQL in Supabase:

- Open Supabase Dashboard → **SQL Editor**
- Copy/paste the file in `supabase/migrations/` (the latest one)
- Run it

This creates:
- `public.project_status` enum
- `public.projects` table (includes `owner_id`)
- RLS policies so users only access their own rows

## 4) Enable email+password auth
Supabase Dashboard → **Authentication → Providers → Email**
- Enable **Email**
- For local testing, you can keep confirmations off (optional).

## 5) Run locally
```bash
npm install
npm run dev
```

App routes:
- Marketing: `/`
- Auth: `/auth`
- Dashboard: `/dashboard`
- Projects: `/projects`
- New project: `/projects/new`

## Notes
- This build intentionally avoids magic-link redirects. It uses **email + password** sign-in.
- Next steps: PDF upload/storage, estimate line items, activity log, teams (`project_members`).