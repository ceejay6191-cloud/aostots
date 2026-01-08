-- Admin notes for users and organizations

create table if not exists public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  org_id uuid null references public.organizations(id) on delete cascade,
  note text not null,
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint admin_notes_target_check check (
    (user_id is not null and org_id is null) or (user_id is null and org_id is not null)
  )
);

create index if not exists admin_notes_user_idx on public.admin_notes(user_id);
create index if not exists admin_notes_org_idx on public.admin_notes(org_id);
create index if not exists admin_notes_created_idx on public.admin_notes(created_at);

alter table public.admin_notes enable row level security;

drop policy if exists "admin_notes_select_staff" on public.admin_notes;
create policy "admin_notes_select_staff"
on public.admin_notes
for select
using (public.is_app_staff());

drop policy if exists "admin_notes_insert_operator" on public.admin_notes;
create policy "admin_notes_insert_operator"
on public.admin_notes
for insert
with check (public.is_app_operator());
